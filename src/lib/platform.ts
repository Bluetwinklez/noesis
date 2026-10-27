/**
 * Platform services. In the desktop build these call the Rust core; in the
 * browser preview (used for e2e tests) they fall back to browser storage that
 * is clearly NOT secure secret storage (the UI says so).
 */
import { safeFileName } from './util';

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/**
 * Downloads a user-supplied web page for import. In the desktop build Rust resolves
 * every hop and refuses local/private addresses (including after redirects).
 */
export async function fetchPublicUrl(url: string, init?: RequestInit): Promise<Response> {
  if (!isTauri()) return fetch(url, init);
  const r = await tauriInvoke<{ status: number; contentType: string; finalUrl: string; bytes: number[] }>('fetch_public_url', { url });
  const res = new Response(new Uint8Array(r.bytes), { status: r.status, headers: { 'content-type': r.contentType } });
  Object.defineProperty(res, 'url', { value: r.finalUrl });
  return res;
}

/** fetch that bypasses webview CORS in the desktop build. */
export async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(input, init);
  }
  return fetch(input, init);
}

// ---------------- secrets ----------------
const memSecrets = new Map<string, string>();
const LS_PREFIX = 'noesis.preview-secret.';

export const secrets = {
  /** True when secrets go to Windows Credential Manager. */
  get secure() {
    return isTauri();
  },
  async get(key: string): Promise<string | null> {
    if (isTauri()) return tauriInvoke<string | null>('secret_get', { key });
    try {
      return localStorage.getItem(LS_PREFIX + key);
    } catch {
      return memSecrets.get(key) ?? null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (isTauri()) return tauriInvoke('secret_set', { key, value });
    try {
      localStorage.setItem(LS_PREFIX + key, value);
    } catch {
      memSecrets.set(key, value);
    }
  },
  async remove(key: string): Promise<void> {
    if (isTauri()) return tauriInvoke('secret_delete', { key });
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      memSecrets.delete(key);
    }
  },
};

// ---------------- attachment blob storage ----------------
const blobMem = new Map<string, Uint8Array>();
let blobDb: Promise<IDBDatabase> | null = null;
function blobIdb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  blobDb ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('noesis-blobs', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return blobDb;
}

/** Large files live outside SQLite; rows hold the stable storage key. */
export const blobStore = {
  async put(fileName: string, bytes: Uint8Array): Promise<string> {
    if (isTauri())
      return tauriInvoke<string>('attachment_write', { fileName: safeFileName(fileName), bytes: Array.from(bytes) });
    const key = `${crypto.randomUUID()}-${safeFileName(fileName)}`;
    const d = blobIdb();
    if (!d) {
      blobMem.set(key, bytes);
      return key;
    }
    const db = await d;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put(bytes, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return key;
  },
  async get(key: string): Promise<Uint8Array> {
    if (isTauri()) return new Uint8Array(await tauriInvoke<number[]>('attachment_read', { key }));
    const d = blobIdb();
    if (!d) {
      const v = blobMem.get(key);
      if (!v) throw new Error('Attachment not found');
      return v;
    }
    const db = await d;
    const v = await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const req = db.transaction('blobs').objectStore('blobs').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!v) throw new Error('Attachment not found');
    return v;
  },
  async remove(key: string): Promise<void> {
    if (isTauri()) return tauriInvoke('attachment_delete', { key });
    blobMem.delete(key);
    const d = blobIdb();
    if (!d) return;
    const db = await d;
    db.transaction('blobs', 'readwrite').objectStore('blobs').delete(key);
  },
};

// ---------------- file save / open ----------------
export async function saveFile(
  defaultName: string,
  data: Uint8Array | string,
  filters: { name: string; extensions: string[] }[] = [],
): Promise<string | null> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (isTauri()) {
    // The Rust side owns the save dialog and the write, so the target path never comes from page script.
    return tauriInvoke<string | null>('export_save', { defaultName: safeFileName(defaultName), filters: filters ?? [], bytes: Array.from(bytes) });
  }
  const blob = new Blob([bytes as BlobPart]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = safeFileName(defaultName);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return defaultName;
}

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

/** Opens a file picker and returns file contents. */
export function pickFiles(accept: string, multiple = true): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    // The input stays attached until it reports a result: detached inputs can be
    // garbage-collected before `change` fires.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (files: PickedFile[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', async () => done(await readFiles(Array.from(input.files ?? []))));
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}

export async function readFiles(files: File[]): Promise<PickedFile[]> {
  return Promise.all(
    files.map(async (f) => ({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
}

export async function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    return openUrl(url);
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function notify(title: string, body: string): Promise<boolean> {
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification');
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === 'granted';
    if (granted) n.sendNotification({ title, body });
    return granted;
  }
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'granted') new Notification(title, { body });
  return Notification.permission === 'granted';
}

export interface AppInfo {
  dataDir: string;
  version: string;
  dbPath: string;
  dbBytes: number;
  attachmentsBytes: number;
}

export async function appInfo(): Promise<AppInfo | null> {
  if (!isTauri()) return null;
  return tauriInvoke<AppInfo>('app_info');
}

export async function revealDataDir() {
  if (!isTauri()) return;
  const info = await appInfo();
  if (!info) return;
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(info.dbPath);
}
