import type { Executor } from '../db/driver';
import type { SearchKind } from '../types';

/** Keeps the unified FTS5 index in step with the source tables. */
export async function indexUpsert(
  ex: Executor,
  kind: SearchKind,
  refId: string,
  workspaceId: string,
  parentId: string | null,
  title: string,
  body: string,
) {
  await ex.run('DELETE FROM search_index WHERE kind = ? AND ref_id = ?', [kind, refId]);
  await ex.run(
    'INSERT INTO search_index(kind, ref_id, workspace_id, parent_id, title, body) VALUES (?,?,?,?,?,?)',
    [kind, refId, workspaceId, parentId ?? '', title, body.slice(0, 200_000)],
  );
}

export async function indexRemove(ex: Executor, kind: SearchKind, refId: string) {
  await ex.run('DELETE FROM search_index WHERE kind = ? AND ref_id = ?', [kind, refId]);
}

export async function indexRemoveByParent(ex: Executor, kind: SearchKind, parentId: string) {
  await ex.run('DELETE FROM search_index WHERE kind = ? AND parent_id = ?', [kind, parentId]);
}

/** Converts free text to a safe FTS5 query (prefix match on each term). */
export function toFtsQuery(input: string, mode: 'all' | 'any' = 'all'): string {
  const terms = input
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 16)
    .map((t) => `"${t.replace(/"/g, '""')}"*`);
  return terms.join(mode === 'all' ? ' AND ' : ' OR ');
}
