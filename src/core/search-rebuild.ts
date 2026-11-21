import type { Database, Executor } from './db/driver';
import { displayValue } from './repos/databases';
import { indexUpsert } from './repos/search-index';
import type { CellValue, DbProperty, PropertyOptions, PropertyType } from './types';
import { parseJson } from '../lib/util';

export interface SearchIndexCounts {
  pages: number;
  rows: number;
  tasks: number;
  notebooks: number;
  notes: number;
  sources: number;
  chunks: number;
}

export interface RebuildSearchIndexOptions {
  /** Maximum records indexed per transaction batch. Default: 200. */
  batchSize?: number;
}

export interface SearchIndexStatus {
  livePages: number;
  indexedPages: number;
  mismatch: boolean;
}

interface RawProp {
  id: string;
  database_id: string;
  name: string;
  type: PropertyType;
  options_json: string;
  sort_order: number;
}

interface PageRow {
  _rowid: number;
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  content_text: string;
}

interface DbRowRecord {
  _rowid: number;
  id: string;
  database_id: string;
  values_json: string;
  workspace_id: string;
}

interface TaskRow {
  _rowid: number;
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  notes: string;
}

interface NotebookRow {
  _rowid: number;
  id: string;
  workspace_id: string;
  title: string;
  description: string;
}

interface NotebookNoteRow {
  _rowid: number;
  id: string;
  notebook_id: string;
  title: string;
  content_md: string;
  workspace_id: string;
}

interface SourceRow {
  _rowid: number;
  id: string;
  workspace_id: string;
  title: string;
  text_content: string;
}

const DEFAULT_BATCH_SIZE = 200;

function yieldTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadPropsByDatabase(ex: Executor, workspaceId?: string): Promise<Map<string, DbProperty[]>> {
  const sql = workspaceId
    ? `SELECT pr.id, pr.database_id, pr.name, pr.type, pr.options_json, pr.sort_order
       FROM db_properties pr
       JOIN pages p ON p.id = pr.database_id
       WHERE p.workspace_id = ? AND p.deleted_at IS NULL AND p.archived_at IS NULL
       ORDER BY pr.sort_order`
    : `SELECT pr.id, pr.database_id, pr.name, pr.type, pr.options_json, pr.sort_order
       FROM db_properties pr
       JOIN pages p ON p.id = pr.database_id
       WHERE p.deleted_at IS NULL AND p.archived_at IS NULL
       ORDER BY pr.sort_order`;
  const rawProps = await ex.all<RawProp>(sql, workspaceId ? [workspaceId] : []);
  const map = new Map<string, DbProperty[]>();
  for (const r of rawProps) {
    const prop: DbProperty = {
      id: r.id,
      database_id: r.database_id,
      name: r.name,
      type: r.type,
      options: parseJson<PropertyOptions>(r.options_json, {}),
      sort_order: r.sort_order,
    };
    const list = map.get(r.database_id);
    if (list) list.push(prop);
    else map.set(r.database_id, [prop]);
  }
  return map;
}

async function indexDbRow(
  ex: Executor,
  row: Omit<DbRowRecord, '_rowid'>,
  propsByDb: Map<string, DbProperty[]>,
): Promise<void> {
  const props = propsByDb.get(row.database_id) ?? [];
  const values = parseJson<Record<string, CellValue>>(row.values_json, {});
  const titleProp = props.find((p) => p.type === 'title');
  const title = titleProp ? String(values[titleProp.id] ?? '') : '';
  const body = props
    .filter((p) => p.type !== 'title')
    .map((p) => `${p.name}: ${displayValue(p, values[p.id])}`)
    .join('\n');
  await indexUpsert(ex, 'row', row.id, row.workspace_id, row.database_id, title, body);
}

async function runBatches<T extends { _rowid: number }>(
  db: Database,
  batchSize: number,
  fetchBatch: (afterRowid: number | null, limit: number) => Promise<T[]>,
  indexItem: (tx: Executor, item: T) => Promise<void>,
): Promise<number> {
  let afterRowid: number | null = null;
  let total = 0;
  for (;;) {
    const batch = await fetchBatch(afterRowid, batchSize);
    if (!batch.length) break;
    await db.transaction(async (tx) => {
      for (const item of batch) await indexItem(tx, item);
    });
    total += batch.length;
    afterRowid = batch[batch.length - 1]._rowid;
    if (batch.length < batchSize) break;
    await yieldTick();
  }
  return total;
}

/**
 * Compares the number of live (non-trashed, non-archived) pages in a workspace
 * against the number of indexed page rows in `search_index`.
 */
export async function searchIndexMismatch(db: Database, workspaceId: string): Promise<SearchIndexStatus> {
  const live = await db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL',
    [workspaceId],
  );
  const indexed = await db.get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM search_index WHERE workspace_id = ? AND kind = 'page'",
    [workspaceId],
  );
  const livePages = live?.c ?? 0;
  const indexedPages = indexed?.c ?? 0;
  return { livePages, indexedPages, mismatch: livePages !== indexedPages };
}

/**
 * Clears and rebuilds the full-text index for one workspace in batched transactions
 * so large workspaces stay responsive. Returns indexed counts per entity kind.
 */
export async function rebuildSearchIndex(
  db: Database,
  workspaceId: string,
  options: RebuildSearchIndexOptions = {},
): Promise<SearchIndexCounts> {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE));

  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM search_index WHERE workspace_id = ?', [workspaceId]);
  });

  const pages = await runBatches<PageRow>(
    db,
    batchSize,
    (after, limit) =>
      after === null
        ? db.all<PageRow>(
            `SELECT rowid AS _rowid, id, workspace_id, parent_id, title, content_text
             FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL
             ORDER BY rowid LIMIT ?`,
            [workspaceId, limit],
          )
        : db.all<PageRow>(
            `SELECT rowid AS _rowid, id, workspace_id, parent_id, title, content_text
             FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND rowid > ?
             ORDER BY rowid LIMIT ?`,
            [workspaceId, after, limit],
          ),
    (tx, p) => indexUpsert(tx, 'page', p.id, p.workspace_id, p.parent_id, p.title, p.content_text),
  );

  const propsByDb = await loadPropsByDatabase(db, workspaceId);
  const rows = await runBatches<DbRowRecord>(
    db,
    batchSize,
    (after, limit) =>
      after === null
        ? db.all<DbRowRecord>(
            `SELECT r.rowid AS _rowid, r.id, r.database_id, r.values_json, p.workspace_id
             FROM db_rows r JOIN pages p ON p.id = r.database_id
             WHERE p.workspace_id = ? AND p.deleted_at IS NULL AND p.archived_at IS NULL
             ORDER BY r.rowid LIMIT ?`,
            [workspaceId, limit],
          )
        : db.all<DbRowRecord>(
            `SELECT r.rowid AS _rowid, r.id, r.database_id, r.values_json, p.workspace_id
             FROM db_rows r JOIN pages p ON p.id = r.database_id
             WHERE p.workspace_id = ? AND p.deleted_at IS NULL AND p.archived_at IS NULL AND r.rowid > ?
             ORDER BY r.rowid LIMIT ?`,
            [workspaceId, after, limit],
          ),
    (tx, r) => indexDbRow(tx, r, propsByDb),
  );

  const tasks = await runBatches<TaskRow>(
    db,
    batchSize,
    (after, limit) =>
      after === null
        ? db.all<TaskRow>(
            'SELECT rowid AS _rowid, id, workspace_id, parent_id, title, notes FROM tasks WHERE workspace_id = ? ORDER BY rowid LIMIT ?',
            [workspaceId, limit],
          )
        : db.all<TaskRow>(
            'SELECT rowid AS _rowid, id, workspace_id, parent_id, title, notes FROM tasks WHERE workspace_id = ? AND rowid > ? ORDER BY rowid LIMIT ?',
            [workspaceId, after, limit],
          ),
    (tx, t) => indexUpsert(tx, 'task', t.id, t.workspace_id, t.parent_id, t.title, t.notes),
  );

  const notebooks = await runBatches<NotebookRow>(
    db,
    batchSize,
    (after, limit) =>
      after === null
        ? db.all<NotebookRow>(
            'SELECT rowid AS _rowid, id, workspace_id, title, description FROM notebooks WHERE workspace_id = ? ORDER BY rowid LIMIT ?',
            [workspaceId, limit],
          )
        : db.all<NotebookRow>(
            'SELECT rowid AS _rowid, id, workspace_id, title, description FROM notebooks WHERE workspace_id = ? AND rowid > ? ORDER BY rowid LIMIT ?',
            [workspaceId, after, limit],
          ),
    (tx, n) => indexUpsert(tx, 'notebook', n.id, n.workspace_id, null, n.title, n.description),
  );

  const notes = await runBatches<NotebookNoteRow>(
    db,
    batchSize,
    (after, limit) =>
      after === null
        ? db.all<NotebookNoteRow>(
            `SELECT nn.rowid AS _rowid, nn.id, nn.notebook_id, nn.title, nn.content_md, nb.workspace_id
             FROM notebook_notes nn JOIN notebooks nb ON nb.id = nn.notebook_id
             WHERE nb.workspace_id = ? ORDER BY nn.rowid LIMIT ?`,
            [workspaceId, limit],
          )
        : db.all<NotebookNoteRow>(
            `SELECT nn.rowid AS _rowid, nn.id, nn.notebook_id, nn.title, nn.content_md, nb.workspace_id
             FROM notebook_notes nn JOIN notebooks nb ON nb.id = nn.notebook_id
             WHERE nb.workspace_id = ? AND nn.rowid > ? ORDER BY nn.rowid LIMIT ?`,
            [workspaceId, after, limit],
          ),
    (tx, n) => indexUpsert(tx, 'note', n.id, n.workspace_id, n.notebook_id, n.title, n.content_md),
  );

  const sources = await runBatches<SourceRow>(
    db,
    batchSize,
    (after, limit) =>
      after === null
        ? db.all<SourceRow>(
            `SELECT rowid AS _rowid, id, workspace_id, title, text_content
             FROM sources WHERE workspace_id = ? AND status = 'ready' ORDER BY rowid LIMIT ?`,
            [workspaceId, limit],
          )
        : db.all<SourceRow>(
            `SELECT rowid AS _rowid, id, workspace_id, title, text_content
             FROM sources WHERE workspace_id = ? AND status = 'ready' AND rowid > ? ORDER BY rowid LIMIT ?`,
            [workspaceId, after, limit],
          ),
    (tx, s) => indexUpsert(tx, 'source', s.id, s.workspace_id, null, s.title, s.text_content.slice(0, 20000)),
  );

  const chunks = await db.transaction(async (tx) => {
    await tx.run("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')");
    const row = await tx.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM source_chunks c JOIN sources s ON s.id = c.source_id WHERE s.workspace_id = ?',
      [workspaceId],
    );
    return row?.c ?? 0;
  });

  return { pages, rows, tasks, notebooks, notes, sources, chunks };
}

/**
 * Rebuilds the FTS indexes inside an already-open transaction (used by backup restore).
 * When `workspaceId` is omitted, rebuilds across all workspaces.
 */
export async function rebuildSearchIndexInTx(ex: Executor, workspaceId?: string): Promise<SearchIndexCounts> {
  const params = workspaceId ? [workspaceId] : [];
  if (workspaceId) await ex.run('DELETE FROM search_index WHERE workspace_id = ?', params);
  else await ex.run('DELETE FROM search_index');
  await ex.run("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')");

  const pages = await ex.all<Omit<PageRow, '_rowid'>>(
    workspaceId
      ? 'SELECT id, workspace_id, parent_id, title, content_text FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL'
      : 'SELECT id, workspace_id, parent_id, title, content_text FROM pages WHERE deleted_at IS NULL AND archived_at IS NULL',
    params,
  );
  for (const p of pages) await indexUpsert(ex, 'page', p.id, p.workspace_id, p.parent_id, p.title, p.content_text);

  const propsByDb = await loadPropsByDatabase(ex, workspaceId);
  const rows = await ex.all<Omit<DbRowRecord, '_rowid'>>(
    workspaceId
      ? `SELECT r.id, r.database_id, r.values_json, p.workspace_id
         FROM db_rows r JOIN pages p ON p.id = r.database_id
         WHERE p.workspace_id = ? AND p.deleted_at IS NULL AND p.archived_at IS NULL`
      : `SELECT r.id, r.database_id, r.values_json, p.workspace_id
         FROM db_rows r JOIN pages p ON p.id = r.database_id
         WHERE p.deleted_at IS NULL AND p.archived_at IS NULL`,
    params,
  );
  for (const r of rows) await indexDbRow(ex, r, propsByDb);

  const tasks = await ex.all<Omit<TaskRow, '_rowid'>>(
    workspaceId
      ? 'SELECT id, workspace_id, parent_id, title, notes FROM tasks WHERE workspace_id = ?'
      : 'SELECT id, workspace_id, parent_id, title, notes FROM tasks',
    params,
  );
  for (const t of tasks) await indexUpsert(ex, 'task', t.id, t.workspace_id, t.parent_id, t.title, t.notes);

  const notebooks = await ex.all<Omit<NotebookRow, '_rowid'>>(
    workspaceId
      ? 'SELECT id, workspace_id, title, description FROM notebooks WHERE workspace_id = ?'
      : 'SELECT id, workspace_id, title, description FROM notebooks',
    params,
  );
  for (const n of notebooks) await indexUpsert(ex, 'notebook', n.id, n.workspace_id, null, n.title, n.description);

  const notes = await ex.all<Omit<NotebookNoteRow, '_rowid'>>(
    workspaceId
      ? 'SELECT nn.id, nn.notebook_id, nn.title, nn.content_md, nb.workspace_id FROM notebook_notes nn JOIN notebooks nb ON nb.id = nn.notebook_id WHERE nb.workspace_id = ?'
      : 'SELECT nn.id, nn.notebook_id, nn.title, nn.content_md, nb.workspace_id FROM notebook_notes nn JOIN notebooks nb ON nb.id = nn.notebook_id',
    params,
  );
  for (const n of notes) await indexUpsert(ex, 'note', n.id, n.workspace_id, n.notebook_id, n.title, n.content_md);

  const sources = await ex.all<Omit<SourceRow, '_rowid'>>(
    workspaceId
      ? "SELECT id, workspace_id, title, text_content FROM sources WHERE workspace_id = ? AND status = 'ready'"
      : "SELECT id, workspace_id, title, text_content FROM sources WHERE status = 'ready'",
    params,
  );
  for (const s of sources) await indexUpsert(ex, 'source', s.id, s.workspace_id, null, s.title, s.text_content.slice(0, 20000));

  const chunkRow = await ex.get<{ c: number }>(
    workspaceId
      ? 'SELECT COUNT(*) AS c FROM source_chunks c JOIN sources s ON s.id = c.source_id WHERE s.workspace_id = ?'
      : 'SELECT COUNT(*) AS c FROM source_chunks',
    params,
  );

  return {
    pages: pages.length,
    rows: rows.length,
    tasks: tasks.length,
    notebooks: notebooks.length,
    notes: notes.length,
    sources: sources.length,
    chunks: chunkRow?.c ?? 0,
  };
}
