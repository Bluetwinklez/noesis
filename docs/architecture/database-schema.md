# Database schema

Generated from `src/core/db/migrations.ts` (schema version 1). SQLite with `PRAGMA foreign_keys = ON`.

## Conventions

- IDs are UUID strings; timestamps are Unix epoch milliseconds.
- Each migration runs in its own transaction and is recorded in `schema_migrations(version, name, applied_at)`. A database newer than the app refuses to open instead of being downgraded.
- Large binaries (attachments, imported files, audio) live in the attachment store on disk, not in SQLite. Rows reference them by a stable `storage_key`.
- `PRAGMA integrity_check` and `PRAGMA foreign_key_check` run at startup (`integrityCheck`). On desktop, a database that fails the check is moved aside and a fresh one is created (see `src-tauri/src/lib.rs`).

## Tables

| Table | Purpose |
|---|---|
| `workspaces` | Top-level containers; every other entity is scoped to one. |
| `pages` | Pages, notes and databases (a database is a page with `kind = database`). Tree via `parent_id`; soft delete via `deleted_at`; Tiptap JSON in `content_json`. |
| `page_snapshots` | Content snapshots of a page (version history / recovery). |
| `page_links` | Explicit links and mentions between pages (backlinks, graph edges). Rebuilt from content on save. |
| `tags` | Workspace tags. |
| `page_tags` | Page ↔ tag join table. |
| `recents` | Recently opened pages. |
| `attachments` | Metadata for files stored outside the database; `storage_key` points at the attachment store. |
| `db_properties` | Database columns (type + JSON config). |
| `db_rows` | Database records; values are JSON keyed by property id. |
| `db_views` | Saved views (type, sort, filter, group). |
| `tasks` | Tasks with subtasks (`parent_id`), priority 0–3, status, due/remind dates, recurrence (daily/weekly/monthly/yearly), project page and originating page (`source_page_id`). |
| `notebooks` | AI research notebooks. |
| `sources` | Imported sources with pipeline `status`, `stage` and `error`. |
| `source_chunks` | Text chunks with provenance (page number, char offsets) and optional embedding. |
| `chunks_fts` | FTS5 index over `source_chunks.text` (external content, kept in sync by triggers). |
| `notebook_sources` | Notebook ↔ source selection. |
| `chat_messages` | Notebook chat history including citation JSON. |
| `notebook_notes` | Notes saved inside a notebook (generated or user-written). |
| `audio_overviews` | Generated audio overviews: script, transcript, audio storage key. |
| `semantic_links` | AI-suggested relationships; only `approved` ones become graph edges. |
| `settings` | Key/value app settings (non-secret). |
| `search_index` | Unified FTS5 index over pages, rows, tasks, notebooks and sources for global search. |

## DDL

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  icon TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('page','database')),
  title TEXT NOT NULL DEFAULT '',
  icon TEXT,
  cover TEXT,
  content_json TEXT,
  content_text TEXT NOT NULL DEFAULT '',
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_template INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  deleted_at INTEGER,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_pages_parent ON pages(workspace_id, parent_id, sort_order);
CREATE INDEX idx_pages_updated ON pages(workspace_id, updated_at DESC);
CREATE INDEX idx_pages_deleted ON pages(deleted_at);

CREATE TABLE page_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_snapshots_page ON page_snapshots(page_id, created_at DESC);

CREATE TABLE page_links (
  source_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, target_id)
);
CREATE INDEX idx_links_target ON page_links(target_id);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'gray',
  UNIQUE (workspace_id, name)
);
CREATE TABLE page_tags (
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, tag_id)
);

CREATE TABLE recents (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  visited_at INTEGER NOT NULL
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE db_properties (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('title','text','number','date','checkbox','select','multi_select','url','relation','status','formula')),
  options_json TEXT NOT NULL DEFAULT '{}',
  sort_order REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_props_db ON db_properties(database_id, sort_order);

CREATE TABLE db_rows (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  values_json TEXT NOT NULL DEFAULT '{}',
  sort_order REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_rows_db ON db_rows(database_id, sort_order);

CREATE TABLE db_views (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('table','board','calendar','list','gallery')),
  config_json TEXT NOT NULL DEFAULT '{}',
  sort_order REAL NOT NULL DEFAULT 0
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  project_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  source_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','cancelled')),
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  due_at INTEGER,
  remind_at INTEGER,
  notified_at INTEGER,
  recurrence TEXT CHECK (recurrence IN ('daily','weekly','monthly','yearly')),
  completed_at INTEGER,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_ws ON tasks(workspace_id, status, due_at);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);

CREATE TABLE notebooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','error')),
  stage TEXT NOT NULL DEFAULT 'import',
  error TEXT,
  text_content TEXT NOT NULL DEFAULT '',
  page_count INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  embedding_model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_sources_ws ON sources(workspace_id, created_at DESC);

CREATE TABLE source_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  page_number INTEGER,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  embedding TEXT,
  UNIQUE (source_id, ordinal)
);

CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='source_chunks', content_rowid='id', tokenize = 'unicode61 remove_diacritics 2');
CREATE TRIGGER chunks_ai AFTER INSERT ON source_chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON source_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER chunks_au AFTER UPDATE OF text ON source_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE notebook_sources (
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  selected INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (notebook_id, source_id)
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','error','cancelled')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_chat_nb ON chat_messages(notebook_id, created_at);

CREATE TABLE notebook_notes (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL DEFAULT '{}',
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE audio_overviews (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  length TEXT NOT NULL,
  format TEXT NOT NULL,
  script_json TEXT NOT NULL,
  attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE semantic_links (
  id TEXT PRIMARY KEY,
  from_kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','approved','rejected')),
  created_at INTEGER NOT NULL,
  UNIQUE (from_kind, from_id, to_kind, to_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE VIRTUAL TABLE search_index USING fts5(
  kind UNINDEXED, ref_id UNINDEXED, workspace_id UNINDEXED, parent_id UNINDEXED,
  title, body, tokenize = 'unicode61 remove_diacritics 2'
);
```
