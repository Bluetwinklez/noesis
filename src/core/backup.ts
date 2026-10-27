import JSZip from 'jszip';
import type { Database, Executor, Row, SqlValue } from './db/driver';
import { LATEST_VERSION } from './db/migrations';
import { indexUpsert } from './repos/search-index';
import { parseJson, sha256Hex } from '../lib/util';
import type { CellValue, PropertyType } from './types';

/** Tables in foreign-key order. FTS tables are rebuilt, not copied. */
export const BACKUP_TABLES = [
  'workspaces',
  'pages',
  'page_snapshots',
  'page_links',
  'tags',
  'page_tags',
  'recents',
  'attachments',
  'db_properties',
  'db_rows',
  'db_views',
  'tasks',
  'notebooks',
  'sources',
  'source_chunks',
  'notebook_sources',
  'chat_messages',
  'notebook_notes',
  'audio_overviews',
  'semantic_links',
  'settings',
] as const;

export interface BackupManifest {
  format: 'noesis-backup';
  formatVersion: 1;
  schemaVersion: number;
  createdAt: string;
  appVersion: string;
  tables: Record<string, number>;
  attachments: { key: string; sha256: string; size: number }[];
  dataSha256: string;
}

export interface BlobAccess {
  get(key: string): Promise<Uint8Array>;
  put(fileName: string, bytes: Uint8Array): Promise<string>;
}

export async function createBackup(db: Database, blobs: BlobAccess | null, appVersion = '0.1.0'): Promise<Uint8Array> {
  const data: Record<string, Row[]> = {};
  for (const t of BACKUP_TABLES) data[t] = await db.all(`SELECT * FROM ${t}`);
  const dataJson = JSON.stringify(data);
  const zip = new JSZip();
  const attachments: BackupManifest['attachments'] = [];
  if (blobs) {
    for (const a of data.attachments as { storage_key: string }[]) {
      try {
        const bytes = await blobs.get(a.storage_key);
        zip.file(`attachments/${encodeURIComponent(a.storage_key)}`, bytes);
        attachments.push({ key: a.storage_key, sha256: await sha256Hex(bytes), size: bytes.byteLength });
      } catch {
        /* missing file: recorded as absent; restore keeps the metadata row */
      }
    }
  }
  const dataBytes = new TextEncoder().encode(dataJson);
  const manifest: BackupManifest = {
    format: 'noesis-backup',
    formatVersion: 1,
    schemaVersion: LATEST_VERSION,
    createdAt: new Date().toISOString(),
    appVersion,
    tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, data[t].length])),
    attachments,
    dataSha256: await sha256Hex(dataBytes),
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('data.json', dataBytes);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export class BackupError extends Error {}

/** Validates an archive without touching the database. */
export async function inspectBackup(bytes: Uint8Array): Promise<{ manifest: BackupManifest; data: Record<string, Row[]>; zip: JSZip }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new BackupError('The file is not a valid Noesis backup archive.');
  }
  const mf = zip.file('manifest.json');
  const df = zip.file('data.json');
  if (!mf || !df) throw new BackupError('Backup archive is missing manifest.json or data.json.');
  const manifest = parseJson<BackupManifest | null>(await mf.async('string'), null);
  if (!manifest || manifest.format !== 'noesis-backup') throw new BackupError('Unrecognised backup format.');
  if (manifest.schemaVersion > LATEST_VERSION)
    throw new BackupError('This backup was created by a newer version of Noesis. Update the app to restore it.');
  const dataBytes = await df.async('uint8array');
  if ((await sha256Hex(dataBytes)) !== manifest.dataSha256)
    throw new BackupError('Backup integrity check failed: data checksum does not match (file is corrupted).');
  const data = parseJson<Record<string, Row[]> | null>(new TextDecoder().decode(dataBytes), null);
  if (!data) throw new BackupError('Backup data is unreadable.');
  for (const [t, n] of Object.entries(manifest.tables)) {
    if ((data[t]?.length ?? 0) !== n) throw new BackupError(`Backup integrity check failed for table ${t}.`);
  }
  return { manifest, data, zip };
}

/**
 * Replaces all local data with the backup content inside one transaction, so
 * a failure leaves the existing data untouched.
 */
export async function restoreBackup(db: Database, bytes: Uint8Array, blobs: BlobAccess | null): Promise<BackupManifest> {
  const { manifest, data, zip } = await inspectBackup(bytes);
  // Write attachment files first; rows reference the new storage keys.
  const keyMap = new Map<string, string>();
  if (blobs) {
    for (const a of manifest.attachments) {
      const f = zip.file(`attachments/${encodeURIComponent(a.key)}`);
      if (!f) continue;
      const content = await f.async('uint8array');
      if ((await sha256Hex(content)) !== a.sha256) throw new BackupError(`Attachment ${a.key} is corrupted.`);
      const name = a.key.replace(/^[0-9a-f-]{36}-/, '');
      keyMap.set(a.key, await blobs.put(name, content));
    }
  }
  await db.run('PRAGMA foreign_keys = OFF');
  try {
    await db.transaction(async (tx) => {
      for (const t of [...BACKUP_TABLES].reverse()) await tx.run(`DELETE FROM ${t}`);
      await tx.run('DELETE FROM search_index');
      for (const t of BACKUP_TABLES) {
        const rows = data[t] ?? [];
        if (!rows.length) continue;
        const cols = await tableColumns(tx, t);
        for (const r of rows) {
          if (t === 'attachments' && keyMap.has(String(r.storage_key))) r.storage_key = keyMap.get(String(r.storage_key));
          const present = cols.filter((c) => c in r);
          await tx.run(
            `INSERT INTO ${t}(${present.join(',')}) VALUES (${present.map(() => '?').join(',')})`,
            present.map((c) => r[c] as SqlValue),
          );
        }
      }
      const fk = await tx.all('PRAGMA foreign_key_check');
      if (fk.length) throw new BackupError(`Backup contains ${fk.length} broken references; restore aborted.`);
      await rebuildSearchIndex(tx);
    });
  } finally {
    await db.run('PRAGMA foreign_keys = ON');
  }
  return manifest;
}

async function tableColumns(ex: Executor, table: string): Promise<string[]> {
  const rows = await ex.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

/** Recomputes all FTS indexes from the source tables. */
export async function rebuildSearchIndex(ex: Executor) {
  await ex.run('DELETE FROM search_index');
  await ex.run("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')");
  const pages = await ex.all<{ id: string; workspace_id: string; parent_id: string | null; title: string; content_text: string }>(
    'SELECT id, workspace_id, parent_id, title, content_text FROM pages WHERE deleted_at IS NULL',
  );
  for (const p of pages) await indexUpsert(ex, 'page', p.id, p.workspace_id, p.parent_id, p.title, p.content_text);
  const tasks = await ex.all<{ id: string; workspace_id: string; parent_id: string | null; title: string; notes: string }>(
    'SELECT id, workspace_id, parent_id, title, notes FROM tasks',
  );
  for (const t of tasks) await indexUpsert(ex, 'task', t.id, t.workspace_id, t.parent_id, t.title, t.notes);
  const nbs = await ex.all<{ id: string; workspace_id: string; title: string; description: string }>('SELECT * FROM notebooks');
  for (const n of nbs) await indexUpsert(ex, 'notebook', n.id, n.workspace_id, null, n.title, n.description);
  const notes = await ex.all<{ id: string; notebook_id: string; title: string; content_md: string; workspace_id: string }>(
    'SELECT nn.*, nb.workspace_id FROM notebook_notes nn JOIN notebooks nb ON nb.id = nn.notebook_id',
  );
  for (const n of notes) await indexUpsert(ex, 'note', n.id, n.workspace_id, n.notebook_id, n.title, n.content_md);
  const sources = await ex.all<{ id: string; workspace_id: string; title: string; text_content: string }>(
    "SELECT id, workspace_id, title, text_content FROM sources WHERE status = 'ready'",
  );
  for (const s of sources) await indexUpsert(ex, 'source', s.id, s.workspace_id, null, s.title, s.text_content.slice(0, 20000));
  const rows = await ex.all<{ id: string; database_id: string; values_json: string; workspace_id: string }>(
    'SELECT r.*, p.workspace_id FROM db_rows r JOIN pages p ON p.id = r.database_id WHERE p.deleted_at IS NULL',
  );
  const props = await ex.all<{ id: string; database_id: string; name: string; type: PropertyType }>('SELECT * FROM db_properties');
  for (const r of rows) {
    const values = parseJson<Record<string, CellValue>>(r.values_json, {});
    const own = props.filter((p) => p.database_id === r.database_id);
    const title = String(values[own.find((p) => p.type === 'title')?.id ?? ''] ?? '');
    const body = own
      .filter((p) => p.type !== 'title' && typeof values[p.id] === 'string')
      .map((p) => `${p.name}: ${values[p.id]}`)
      .join('\n');
    await indexUpsert(ex, 'row', r.id, r.workspace_id, r.database_id, title, body);
  }
}
