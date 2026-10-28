import type { Repos } from '../core/store';

export const INTERRUPTED_SOURCE_ERROR = 'processing_interrupted';

/** Runs during boot before ingestion and user actions are enabled. */
export async function recoverInterruptedSources(repos: Repos): Promise<number> {
  const result = await repos.db.run(
    "UPDATE sources SET status = 'error', error = ?, updated_at = ? WHERE status = 'processing'",
    [INTERRUPTED_SOURCE_ERROR, Date.now()],
  );
  if (result.changes) await repos.db.flushNow();
  return result.changes;
}
