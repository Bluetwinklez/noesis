import { DatabaseSync } from 'node:sqlite';
import type { ExecResult, SqlDriver, SqlValue } from './driver';

/** node:sqlite backend used by the automated test-suite and CLI tooling. */
export class NodeDriver implements SqlDriver {
  readonly kind = 'node' as const;
  private db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
  }

  async exec(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
    const stmt = this.db.prepare(sql);
    if (stmt.columns().length > 0) {
      const rows = stmt.all(...(params as never[])) as Record<string, unknown>[];
      return { rows: rows.map((r) => ({ ...r })), changes: 0, lastInsertRowid: 0 };
    }
    const r = stmt.run(...(params as never[]));
    return { rows: [], changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  async close() {
    this.db.close();
  }
}
