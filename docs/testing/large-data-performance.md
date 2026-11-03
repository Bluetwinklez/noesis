# Large-data performance

The plan's large fixture contains **5,000 pages**, **50 databases × 2,000 rows** (100,000 rows total) and **1,000 sources**. Create a fresh native SQLite fixture with:

```powershell
npm run seed:large -- C:\path\to\noesis-large.db
```

The script applies the current migrations before inserting deterministic local data. It refuses to add the fixture twice to the same database. It does not use user documents, attachments or network services.

`npm run bench` exercises the same fixture through the repositories and records `tests/bench/large-results.json`. The Playwright suite installs the generated SQLite snapshot into an isolated browser-test database and measures a real application start and a paginated table render.

## Windows measurements — 2026-11-02

Machine: Windows x64, Node 24.20.0, Rust 1.99.1. Browser checks used Edge through Playwright's development server.

| Operation | Result | Guard |
|---|---:|---:|
| Generate the complete fixture | 1,840 ms | recorded |
| Repository/storage startup | 6.9 ms | < 2,000 ms |
| Browser app ready with 5,000 pages | 1,692 ms; earlier repeat range 1,497–1,826 ms | < 2,000 ms |
| Load sidebar metadata for 5,000 pages | 60.2 ms | recorded |
| Full-text search, 20 measured runs | 23.0 ms median / 28.4 ms p95 | p95 < 200 ms |
| Load, filter and page a 2,000-row table | 19.5 ms | < 500 ms |
| Warm browser table open and paint | 481.6 ms; focused runs 384.5–387.3 ms | < 500 ms |
| Export all 5,000 pages, 100,000 rows and 1,000 sources | 6.65 s / 1,473,051 bytes | recorded |
| Import that archive | 11.32 s | recorded |

The first import baseline took **2,657,495 ms (about 44 minutes)** because every CSV row opened its own transaction, queried properties again and updated the search index separately. The importer now accumulates 500 parsed rows and `DatabaseRepo.addRows` writes/indexes 100 rows per SQLite statement inside one transaction. The final verification imported the same archive about **235× faster** while retaining row order and search results.

## UI bounds

The sidebar initially renders 15 root pages and 15 children per expanded parent. “Show 15 more pages” reveals the next window; navigating directly to a later active page automatically opens the window containing its root. Database tables render 50 rows at a time with Back/Next controls. Filtering and sorting still operate on the complete in-memory result before paging, so paging does not change results. The daily-notes revision measured 1,710.6 ms browser startup and 361.1 ms warm table open in a focused Windows run.

Existing indexes already cover the measured queries (`pages(workspace_id,parent_id,sort_order)`, `db_rows(database_id,sort_order)` and FTS5 search). No schema migration was added only to satisfy the performance task.

The repository startup number is not a packaged desktop process launch. The browser startup test includes SQLite WASM deserialization, application boot and the first usable workspace render. A packaged Windows WebView2 cold-start measurement remains manual.
