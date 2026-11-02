#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrations, splitSql } from '../src/core/db/migrations.ts';

export const LARGE_DATA_COUNTS = Object.freeze({ pages: 5_000, databases: 50, rowsPerDatabase: 2_000, sources: 1_000 });
export const LARGE_WORKSPACE_ID = 'large-data-workspace';

function migrate(db) {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec('BEGIN');
    try {
      for (const statement of splitSql(migration.sql)) db.exec(statement);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)').run(migration.version, migration.name, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function seedLargeData(db, counts = LARGE_DATA_COUNTS) {
  migrate(db);
  const existing = db.prepare('SELECT COUNT(*) AS count FROM workspaces WHERE id = ?').get(LARGE_WORKSPACE_ID).count;
  if (existing) throw new Error(`Workspace ${LARGE_WORKSPACE_ID} already exists; use a fresh database.`);

  const now = Date.now();
  const insertPage = db.prepare(`INSERT INTO pages(
    id, workspace_id, parent_id, kind, title, icon, cover, content_json, content_text,
    is_favorite, is_pinned, is_template, archived_at, deleted_at, sort_order, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertSearch = db.prepare('INSERT INTO search_index(kind, ref_id, workspace_id, parent_id, title, body) VALUES (?,?,?,?,?,?)');
  const insertProperty = db.prepare('INSERT INTO db_properties(id, database_id, name, type, options_json, sort_order) VALUES (?,?,?,?,?,?)');
  const insertView = db.prepare('INSERT INTO db_views(id, database_id, name, type, config_json, sort_order) VALUES (?,?,?,?,?,?)');
  const insertRow = db.prepare('INSERT INTO db_rows(id, database_id, values_json, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)');
  const insertSource = db.prepare(`INSERT INTO sources(
    id, workspace_id, title, kind, origin, mime, size, attachment_id, status, stage, error,
    text_content, page_count, metadata_json, embedding_model, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertChunk = db.prepare('INSERT INTO source_chunks(source_id, ordinal, text, page_number, char_start, char_end, embedding) VALUES (?,?,?,?,?,?,?)');

  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO workspaces(id, name, icon, created_at, updated_at) VALUES (?,?,?,?,?)').run(LARGE_WORKSPACE_ID, 'Large data benchmark', '⚡', now, now);
    for (let i = 0; i < counts.pages; i++) {
      const isDatabase = i < counts.databases;
      const id = isDatabase ? `large-db-${i}` : `large-page-${i}`;
      const title = isDatabase ? `Database ${i + 1}` : `Research page ${i + 1}`;
      const body = `Benchmark corpus page ${i + 1}. Glacier basalt retrieval needle ${i % 97}.`;
      insertPage.run(id, LARGE_WORKSPACE_ID, null, isDatabase ? 'database' : 'page', title, null, null, null, body, 0, 0, 0, null, null, i, now - i, now - i);
      insertSearch.run('page', id, LARGE_WORKSPACE_ID, null, title, body);
      if (!isDatabase) continue;
      const titleProp = `large-title-${i}`;
      const numberProp = `large-number-${i}`;
      insertProperty.run(titleProp, id, 'Name', 'title', '{}', 0);
      insertProperty.run(numberProp, id, 'Value', 'number', '{}', 1);
      insertView.run(`large-view-${i}`, id, 'Table', 'table', '{}', 0);
      for (let row = 0; row < counts.rowsPerDatabase; row++) {
        insertRow.run(`large-row-${i}-${row}`, id, JSON.stringify({ [titleProp]: `Record ${row + 1}`, [numberProp]: row }), row, now - row, now - row);
      }
    }

    for (let i = 0; i < counts.sources; i++) {
      const id = `large-source-${i}`;
      const title = `Source ${i + 1}`;
      const text = `Source benchmark passage ${i + 1}. Evidence retrieval marker ${i % 43}.`;
      insertSource.run(id, LARGE_WORKSPACE_ID, title, 'text', `seed://${i}`, 'text/plain', text.length, null, 'ready', 'done', null, text, 1, '{}', null, now - i, now - i);
      insertChunk.run(id, 0, text, 1, 0, text.length, null);
      insertSearch.run('source', id, LARGE_WORKSPACE_ID, null, title, text);
    }
    db.prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES (?,?)').run('workspaceId', JSON.stringify(LARGE_WORKSPACE_ID));
    db.prepare('INSERT OR REPLACE INTO settings(key, value_json) VALUES (?,?)').run('prefs', JSON.stringify({ onboarded: true }));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.exec('PRAGMA optimize');
  return { ...counts, databaseRows: counts.databases * counts.rowsPerDatabase };
}

async function main() {
  const target = resolve(process.argv[2] ?? 'noesis-large-data.db');
  const db = new DatabaseSync(target);
  const started = performance.now();
  try {
    const counts = seedLargeData(db);
    console.log(JSON.stringify({ path: target, ...counts, elapsedMs: Math.round(performance.now() - started) }, null, 2));
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
