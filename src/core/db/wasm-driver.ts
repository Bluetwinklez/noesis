import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { ExecResult, SqlDriver, SqlValue } from './driver';

const IDB_NAME = 'noesis-storage';
const IDB_STORE = 'snapshots';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result as Uint8Array | undefined); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Browser-preview backend (official SQLite WASM build, includes FTS5).
 * The database lives in memory and is snapshotted to IndexedDB after writes.
 * The desktop build uses the native Rust driver instead.
 */
export class WasmDriver implements SqlDriver {
  readonly kind = 'wasm' as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(private sqlite3: any, private db: any, private key: string | null) {}

  static async open(key = 'main'): Promise<WasmDriver> {
    const snapshot = await idbGet(key);
    return this.fromBytes(snapshot, key);
  }

  /** Isolated in-memory database; never reads or overwrites the failed snapshot. */
  static async empty(): Promise<WasmDriver> {
    return this.fromBytes(undefined, null);
  }

  private static async fromBytes(snapshot: Uint8Array | undefined, key: string | null): Promise<WasmDriver> {
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(':memory:', 'c');
    try {
      if (snapshot) {
        if (!snapshot.byteLength) throw new Error('Stored browser database is empty.');
        const p = sqlite3.wasm.allocFromTypedArray(snapshot);
        const rc = sqlite3.capi.sqlite3_deserialize(
          db.pointer!, 'main', p, snapshot.byteLength, snapshot.byteLength,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
        );
        if (rc !== 0) throw new Error(`Stored browser database could not be loaded (code ${rc}).`);
      }
      if (db.selectValue('PRAGMA quick_check') !== 'ok') throw new Error('Stored browser database failed its integrity check.');
      return new WasmDriver(sqlite3, db, key);
    } catch (error) { db.close(); throw error; }
  }

  static readSnapshot = idbGet;
  static async installSnapshot(key: string, bytes: Uint8Array) {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const previous = store.get(key);
      previous.onsuccess = () => {
        if (previous.result !== undefined) store.put(previous.result, `${key}.pre-recovery-${crypto.randomUUID()}`);
        store.put(bytes, key);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async exec(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
    const rows: Record<string, unknown>[] = [];
    this.db.exec({ sql, bind: params.length ? params : undefined, rowMode: 'object', resultRows: rows });
    return {
      rows,
      changes: this.db.changes(),
      lastInsertRowid: Number(this.sqlite3.capi.sqlite3_last_insert_rowid(this.db.pointer)),
    };
  }

  async flush() {
    if (this.key === null) return;
    const bytes: Uint8Array = this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer);
    await idbPut(this.key, bytes);
  }

  async exportBytes(): Promise<Uint8Array> {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer);
  }
  async close() { this.db.close(); }
}
