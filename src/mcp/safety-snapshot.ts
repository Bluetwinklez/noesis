/**
 * Per-client cooldown throttle for "before AI changes" safety snapshots.
 *
 * Ensures a backup is taken before the first approved destructive MCP action
 * from a given client within a 30-minute window, without slowing down subsequent
 * edits in the same burst.
 */

export const SAFETY_SNAPSHOT_WINDOW_MS = 30 * 60 * 1000;

export interface SafetySnapshotThrottleOptions {
  /** Cooldown window per client in milliseconds (default: 30 minutes). */
  windowMs?: number;
  /** Injectable clock returning epoch milliseconds (default: Date.now). */
  now?: () => number;
  /** Live preference check; when false, snapshots are skipped (default: always true). */
  isEnabled?: () => boolean;
  /** Writes the safety snapshot for the triggering client. */
  takeSnapshot: (client: string) => Promise<unknown>;
}

export class SafetySnapshotThrottle {
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly isEnabled: () => boolean;
  private readonly takeSnapshot: (client: string) => Promise<unknown>;
  private readonly lastSnapshotAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(options: SafetySnapshotThrottleOptions) {
    this.windowMs = options.windowMs ?? SAFETY_SNAPSHOT_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
    this.isEnabled = options.isEnabled ?? (() => true);
    this.takeSnapshot = options.takeSnapshot;
  }

  /**
   * Takes a safety snapshot if enabled and no snapshot was taken for `client`
   * within `windowMs`. Returns `true` when a new snapshot was written, `false`
   * when skipped because the setting is off or a recent snapshot already exists.
   */
  async maybeSnapshot(client: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const key = client.trim() || 'unknown';
    const pending = this.inFlight.get(key);
    if (pending) {
      await pending;
      return false;
    }
    const current = this.now();
    const prev = this.lastSnapshotAt.get(key);
    if (prev !== undefined && current - prev < this.windowMs) {
      return false;
    }
    const run = (async () => {
      await this.takeSnapshot(key);
      this.lastSnapshotAt.set(key, this.now());
    })();
    this.inFlight.set(key, run);
    try {
      await run;
      return true;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Clears recorded per-client timestamps (useful in tests). */
  reset(): void {
    this.lastSnapshotAt.clear();
    this.inFlight.clear();
  }
}
