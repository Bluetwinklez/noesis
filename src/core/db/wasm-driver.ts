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
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
  private constructor(private sqlite3: any, private db: any, private key: string) {}

  static async open(key = 'main'): Promise<WasmDriver> {
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(':memory:', 'c');
    const snapshot = await idbGet(key).catch(() => undefined);
    if (snapshot && snapshot.byteLength > 0) {
      const p = sqlite3.wasm.allocFromTypedArray(snapshot);
      const rc = sqlite3.capi.sqlite3_deserialize(
        db.pointer!, 'main', p, snapshot.byteLength, snapshot.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      );
      if (rc !== 0) throw new Error(`Stored browser database could not be loaded (code ${rc}).`);
    }
    return new WasmDriver(sqlite3, db, key);
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
    const bytes: Uint8Array = this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer);
    await idbPut(this.key, bytes);
  }

  async exportBytes(): Promise<Uint8Array> {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer);
  }
}
