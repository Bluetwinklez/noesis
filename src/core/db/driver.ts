export type SqlValue = string | number | null | Uint8Array;
export type Row = Record<string, unknown>;

export interface ExecResult {
  rows: Row[];
  changes: number;
  lastInsertRowid: number;
}

/** Minimal low-level contract every storage backend implements. */
export interface SqlDriver {
  readonly kind: 'tauri' | 'wasm' | 'node';
  exec(sql: string, params?: SqlValue[]): Promise<ExecResult>;
  /** Called after writes; drivers that snapshot (wasm) persist here. */
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

/** Query surface shared by the database and an open transaction. */
export interface Executor {
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<ExecResult>;
}

class TxExecutor implements Executor {
  constructor(private driver: SqlDriver) {}
  async all<T = Row>(sql: string, params: SqlValue[] = []) {
    return (await this.driver.exec(sql, params)).rows as T[];
  }
  async get<T = Row>(sql: string, params: SqlValue[] = []) {
    return (await this.all<T>(sql, params))[0];
  }
  run(sql: string, params: SqlValue[] = []) {
    return this.driver.exec(sql, params);
  }
}

/**
 * Serialises all statements through one queue so a transaction issued as
 * BEGIN / ... / COMMIT over async IPC can never interleave with another caller.
 * Code inside a transaction must use the `tx` executor it is handed.
 */
export class Database implements Executor {
  private queue: Promise<unknown> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public readonly driver: SqlDriver) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private scheduleFlush() {
    if (!this.driver.flush) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.enqueue(() => this.driver.flush!());
    }, 250);
  }

  all<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.enqueue(async () => (await this.driver.exec(sql, params)).rows as T[]);
  }

  async get<T = Row>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }

  async run(sql: string, params: SqlValue[] = []): Promise<ExecResult> {
    const r = await this.enqueue(() => this.driver.exec(sql, params));
    this.scheduleFlush();
    return r;
  }

  /** Runs fn atomically; everything inside must go through `tx`. */
  async transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    const result = await this.enqueue(async () => {
      await this.driver.exec('BEGIN IMMEDIATE');
      try {
        const value = await fn(new TxExecutor(this.driver));
        await this.driver.exec('COMMIT');
        return value;
      } catch (err) {
        try {
          await this.driver.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        throw err;
      }
    });
    this.scheduleFlush();
    return result;
  }

  /**
   * Waits until every statement queued so far has finished, then forces pending
   * snapshot persistence (wasm driver). Safe to call before quitting.
   */
  async flushNow() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.enqueue(async () => {
      if (this.driver.flush) await this.driver.flush();
    });
  }
}
