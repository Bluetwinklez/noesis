import { invoke } from '@tauri-apps/api/core';
import type { ExecResult, SqlDriver, SqlValue } from './driver';

/** Native SQLite (rusqlite, bundled FTS5) running in the Rust core. */
export class TauriDriver implements SqlDriver {
  readonly kind = 'tauri' as const;

  async exec(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
    const wire = params.map((p) => (p instanceof Uint8Array ? { blob: Array.from(p) } : p));
    return invoke<ExecResult>('db_exec', { sql, params: wire });
  }
}
