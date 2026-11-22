/**
 * Background housekeeping driven by Settings: automatic backups (desktop), emptying
 * old trash, search-index self-healing, and remembering the last opened page for
 * "Open on start: last page".
 */
import type { Database } from '../core/db/driver';
import type { Repos } from '../core/store';
import { BEFORE_AI_BACKUP_LABEL, createBackup, type BlobAccess } from '../core/backup';
import {
  rebuildSearchIndex,
  searchIndexMismatch,
  type RebuildSearchIndexOptions,
  type SearchIndexCounts,
} from '../core/search-rebuild';
import { t } from '../i18n';
import { blobStore, isTauri, packBinary } from '../lib/platform';
import { useApp, type Prefs } from './state';
import { savePrefs } from './services';

const DAY_MS = 86_400_000;
const LAST_PAGE_KEY = 'lastPage';
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.1.0';

export const AUTO_BACKUP_PREFIX = 'noesis-auto-';
export const BEFORE_AI_BACKUP_PREFIX = 'noesis-before-ai-';
export const BEFORE_AI_BACKUP_KEEP = 5;
export { BEFORE_AI_BACKUP_LABEL };

export type AutoBackupKind = 'auto' | 'before-ai';

export interface SavedBackupEntry {
  name: string;
  kind: AutoBackupKind;
  label: string;
  size: number;
  createdAt: number;
}

export interface SafetyBackupStore {
  save(
    bytes: Uint8Array,
    opts: { kind: AutoBackupKind; keep: number; label: string; now: number },
  ): Promise<{ dir: string; count: number; name: string }>;
  list(): Promise<SavedBackupEntry[]>;
  read(name: string): Promise<Uint8Array>;
}

export interface RunBeforeAiBackupOptions {
  db?: Database;
  blobs?: BlobAccess | null;
  appVersion?: string;
  keep?: number;
  now?: number;
  store?: SafetyBackupStore;
  /** Persist lastBeforeAiBackupAt in Prefs when running against the active app state. */
  recordTimestamp?: boolean;
}

/** UTC timestamp `YYYYMMDD-HHMMSS` that sorts chronologically (matches Rust `chrono_like_stamp`). */
export function formatBackupStamp(now = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export function backupPrefixForKind(kind: AutoBackupKind): string {
  return kind === 'before-ai' ? BEFORE_AI_BACKUP_PREFIX : AUTO_BACKUP_PREFIX;
}

/**
 * Keeps at most `keep` newest `.noesisbak` entries matching `prefix` (chronological by name),
 * leaving every other entry (for example rotating daily/weekly backups or manual backups) untouched.
 */
export function pruneBackupList<T extends { name: string }>(
  entries: readonly T[],
  prefix: string,
  keep: number,
): { kept: T[]; removed: T[] } {
  const limit = Math.max(1, Math.floor(keep));
  const matching: T[] = [];
  const other: T[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(prefix) && entry.name.endsWith('.noesisbak')) matching.push(entry);
    else other.push(entry);
  }
  matching.sort((a, b) => a.name.localeCompare(b.name));
  const excess = Math.max(0, matching.length - limit);
  const removed = matching.slice(0, excess);
  const keptMatching = matching.slice(excess);
  return { kept: [...other, ...keptMatching], removed };
}

/** In-memory backup store with the same naming and prefix-isolated retention as the desktop writer. */
export function createMemoryBackupStore(dir = 'memory://backups'): SafetyBackupStore {
  const files = new Map<string, { entry: SavedBackupEntry; bytes: Uint8Array }>();

  const uniqueName = (prefix: string, stamp: string): string => {
    const base = `${prefix}${stamp}.noesisbak`;
    if (!files.has(base)) return base;
    for (let n = 1; n <= 999; n++) {
      const candidate = `${prefix}${stamp}-${String(n).padStart(3, '0')}.noesisbak`;
      if (!files.has(candidate)) return candidate;
    }
    return `${prefix}${stamp}-${crypto.randomUUID().slice(0, 8)}.noesisbak`;
  };

  return {
    async save(bytes, { kind, keep, label, now }) {
      const prefix = backupPrefixForKind(kind);
      const name = uniqueName(prefix, formatBackupStamp(now));
      files.set(name, {
        entry: { name, kind, label, size: bytes.byteLength, createdAt: now },
        bytes: new Uint8Array(bytes),
      });
      const { removed } = pruneBackupList([...files.values()].map((v) => v.entry), prefix, keep);
      for (const r of removed) files.delete(r.name);
      const count = [...files.keys()].filter((n) => n.startsWith(prefix) && n.endsWith('.noesisbak')).length;
      return { dir, count, name };
    },
    async list() {
      return [...files.values()]
        .map((v) => ({ ...v.entry }))
        .sort((a, b) => b.name.localeCompare(a.name));
    },
    async read(name) {
      const found = files.get(name);
      if (!found) throw new Error(`Backup not found: ${name}`);
      return new Uint8Array(found.bytes);
    },
  };
}

const tauriBackupStore: SafetyBackupStore = {
  async save(bytes, { kind, keep }) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<{ dir: string; count: number; name: string }>(
      'backup_auto_save',
      packBinary({ keep, kind }, bytes),
    );
  },
  async list() {
    const { invoke } = await import('@tauri-apps/api/core');
    const items = await invoke<{ name: string; kind: AutoBackupKind; size: number; createdAt: number }[]>('backup_list');
    return items.map((item) => ({
      ...item,
      label: item.kind === 'before-ai' ? BEFORE_AI_BACKUP_LABEL : 'automatic backup',
    }));
  },
  async read(name) {
    const { invoke } = await import('@tauri-apps/api/core');
    return new Uint8Array(await invoke<ArrayBuffer>('backup_read', { name }));
  },
};

/** Pages that stayed in the trash longer than the chosen number of days are deleted for good. */
export async function purgeOldTrash(repos: Repos, days: number, now = Date.now()): Promise<number> {
  if (!days) return 0;
  let purged = 0;
  for (const ws of await repos.workspaces.list()) {
    for (const p of await repos.pages.listTrash(ws.id)) {
      if (p.deleted_at && now - p.deleted_at > days * DAY_MS) {
        await repos.pages.purge(p.id);
        purged++;
      }
    }
  }
  return purged;
}

export function autoBackupDue(prefs: Pick<Prefs, 'autoBackup' | 'lastAutoBackupAt'>, now = Date.now()): boolean {
  if (prefs.autoBackup === 'off') return false;
  const every = prefs.autoBackup === 'daily' ? DAY_MS : 7 * DAY_MS;
  return !prefs.lastAutoBackupAt || now - prefs.lastAutoBackupAt >= every;
}

/** Desktop only: writes a full backup into the app's own backups folder (Rust picks the path). */
export async function runAutoBackup(): Promise<{ dir: string; count: number }> {
  const { repos, prefs } = useApp.getState();
  if (!repos) throw new Error('Noesis is still starting.');
  const bytes = await createBackup(repos.db, blobStore, APP_VERSION);
  const { invoke } = await import('@tauri-apps/api/core');
  const res = await invoke<{ dir: string; count: number }>('backup_auto_save', packBinary({ keep: prefs.autoBackupKeep, kind: 'auto' }, bytes));
  await savePrefs({ lastAutoBackupAt: Date.now() });
  return res;
}

/**
 * Takes an extra safety backup labelled "before AI changes" using the existing backup writer.
 * Kept separate from rotating daily/weekly backups, with its own retention (newest 5 by default).
 */
export async function runBeforeAiBackup(
  options: RunBeforeAiBackupOptions = {},
): Promise<{ dir: string; count: number; name: string } | null> {
  const state = useApp.getState();
  const db = options.db ?? state.repos?.db;
  if (!db) throw new Error('Noesis is still starting.');
  const blobs = options.blobs !== undefined ? options.blobs : blobStore;
  const appVersion = options.appVersion ?? APP_VERSION;
  const keep = options.keep ?? BEFORE_AI_BACKUP_KEEP;
  const now = options.now ?? Date.now();
  const store = options.store ?? (isTauri() ? tauriBackupStore : null);
  if (!store) return null;

  const bytes = await createBackup(db, blobs, appVersion, { label: BEFORE_AI_BACKUP_LABEL });
  const res = await store.save(bytes, { kind: 'before-ai', keep, label: BEFORE_AI_BACKUP_LABEL, now });
  const shouldRecord = options.recordTimestamp ?? (!options.db && !options.store);
  if (shouldRecord && state.repos) {
    await savePrefs({ lastBeforeAiBackupAt: now });
  }
  return res;
}

/** Lists saved automatic and "before AI changes" backups (desktop, or an injected store). */
export async function listSavedBackups(store?: SafetyBackupStore): Promise<SavedBackupEntry[]> {
  const target = store ?? (isTauri() ? tauriBackupStore : null);
  if (!target) return [];
  return target.list();
}

/** Reads one saved backup archive by name so it can be restored through the normal restore flow. */
export async function readSavedBackup(name: string, store?: SafetyBackupStore): Promise<Uint8Array> {
  const target = store ?? (isTauri() ? tauriBackupStore : null);
  if (!target) throw new Error('Saved backups are only available in the desktop app.');
  return target.read(name);
}

/**
 * Compares live and indexed page counts for a workspace and rebuilds the search
 * index when they differ. Returns rebuilt counts, or null when already in sync.
 */
export async function healSearchIndexIfNeeded(
  db: Database,
  workspaceId: string,
  options?: RebuildSearchIndexOptions,
): Promise<SearchIndexCounts | null> {
  const { mismatch } = await searchIndexMismatch(db, workspaceId);
  if (!mismatch) return null;
  return rebuildSearchIndex(db, workspaceId, options);
}

let searchIndexChecked = false;
/** Checks and heals the active workspace's search index at most once per launch. */
export async function checkSearchIndexOnStartup(): Promise<SearchIndexCounts | null> {
  if (searchIndexChecked) return null;
  const { repos, workspaceId, toast, bump } = useApp.getState();
  if (!repos || !workspaceId) return null;
  searchIndexChecked = true;
  try {
    const counts = await healSearchIndexIfNeeded(repos.db, workspaceId);
    if (counts) {
      bump();
      toast(t('settings.indexHealed', { pages: counts.pages }), 'info');
    }
    return counts;
  } catch (e) {
    console.warn('search index self-heal', e);
    return null;
  }
}

let started = false;
export function startMaintenance() {
  if (started) return;
  started = true;
  // Self-heal a stale search index once per launch in the background after boot.
  setTimeout(() => void checkSearchIndexOnStartup(), 0);
  const tick = async () => {
    const { repos, prefs } = useApp.getState();
    if (!repos) return;
    try {
      await purgeOldTrash(repos, prefs.trashRetentionDays);
      if (isTauri() && autoBackupDue(prefs)) await runAutoBackup();
    } catch (e) {
      console.warn('maintenance', e);
    }
  };
  // Shortly after start (not during it), then hourly.
  setTimeout(() => void tick(), 30_000);
  setInterval(() => void tick(), 60 * 60_000);

  // Remember the open page for "Open on start: last page".
  let last: string | null = null;
  useApp.subscribe((s) => {
    const id = s.route.name === 'page' ? s.route.id : null;
    if (id && id !== last && s.repos) {
      last = id;
      void s.repos.settings.set(LAST_PAGE_KEY, id);
    }
  });
}

/** Opens the page that was open last time, if the user chose that and it still exists. */
export async function openStartPage() {
  const { repos, prefs, workspaceId, navigate } = useApp.getState();
  if (!repos || prefs.startPage !== 'last') return;
  const id = await repos.settings.get<string | null>(LAST_PAGE_KEY, null);
  const page = id ? await repos.pages.get(id) : null;
  if (page && !page.deleted_at && page.workspace_id === workspaceId) navigate({ name: 'page', id: page.id }, { replace: true });
}
