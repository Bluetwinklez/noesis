# Task for Antigravity agent: Tauri 2 Rust backend for Noesis

You are working in `C:\Users\dofle\Desktop\desktopp\noesis` (a Vite + React + TS app).
**Only create/edit files under `src-tauri/`.** Do not touch `src/`, `package.json`, or anything else —
another agent is editing those concurrently.

Toolchain: Rust stable (rustup, MSVC) is installed at `%USERPROFILE%\.cargo\bin`; VS 2022 Build Tools installed.
`npx tauri` (CLI 2.12.x) is available from the project root. Frontend dev server: `http://localhost:1420`, build output `../dist`.

## Create
- `src-tauri/Cargo.toml` — package `noesis`, lib name `noesis_lib`, edition 2021. Deps:
  `tauri = "2"` (features: none extra), `tauri-build = "2"` (build-dep), `serde`/`serde_json`,
  `rusqlite = { version = "0.32+", features = ["bundled"] }` (bundled SQLite **must have FTS5**: verify with a test
  that runs `CREATE VIRTUAL TABLE t USING fts5(a)`), `keyring = "3"` with features `["windows-native"]`,
  `uuid` (v4), `sha2` optional, plugins: `tauri-plugin-http` (feature none needed), `tauri-plugin-dialog`,
  `tauri-plugin-notification`, `tauri-plugin-opener`, `tauri-plugin-single-instance`.
- `src-tauri/build.rs`, `src-tauri/src/main.rs` (`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`, calls `noesis_lib::run()`), `src-tauri/src/lib.rs`.
- `src-tauri/tauri.conf.json`: productName `Noesis`, identifier `app.noesis.desktop`, version `0.1.0`,
  `build.frontendDist: "../dist"`, `devUrl: "http://localhost:1420"`, `beforeDevCommand: "npm run dev"`, `beforeBuildCommand: "npm run build"`.
  Window: label `main`, title `Noesis`, 1280x820, minWidth 900, minHeight 600, `decorations: true`, center.
  Security: strict CSP: `default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost https: http://localhost:* http://127.0.0.1:*`.
  Bundle: active, targets `["nsis", "msi"]`, icons from `icons/`, publisher `Noesis`, shortDescription, NSIS `installMode: "currentUser"`, languages English + Turkish. WebView2 install mode `downloadBootstrapper`.
- `src-tauri/capabilities/default.json`: windows `["main"]`, permissions: `core:default`, `dialog:allow-save`, `dialog:allow-open`,
  `notification:default`, `opener:allow-open-url`, `opener:allow-reveal-item-in-dir`, and http with scope
  `{"identifier":"http:default","allow":[{"url":"https://*"},{"url":"https://*:*"},{"url":"http://localhost:*"},{"url":"http://127.0.0.1:*"}]}`.
- Icons: generate with `npx tauri icon public/icon.svg` **if** `public/icon.svg` exists by then; otherwise create a 1024px PNG placeholder at `src-tauri/app-icon.png` (simple indigo rounded square with a white "N") and run `npx tauri icon src-tauri/app-icon.png`.

## Commands (exact names and argument names — the frontend already calls these with camelCase args)
State: one `Mutex<rusqlite::Connection>` opened at `<app_data_dir>/noesis.db` with
`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000`.
Attachments dir: `<app_data_dir>/attachments/`.

1. `db_exec(sql: String, params: Vec<serde_json::Value>) -> Result<ExecResult, String>`
   `ExecResult { rows: Vec<Map<String, Value>>, changes: i64, lastInsertRowid: i64 }` (serialize field names exactly: `rows`, `changes`, `lastInsertRowid`).
   Params: JSON null→NULL, bool→0/1, integer→i64, float→f64, string→TEXT, object `{"blob":[u8...]}`→BLOB.
   If statement has columns (`stmt.column_count() > 0`) return rows (INTEGER→number, REAL→number, TEXT→string, BLOB→array of numbers, NULL→null) else execute and return changes + last_insert_rowid.
   Reject empty SQL and SQL longer than 1 MB. Only a single statement per call (use `prepare`, which fails on trailing statements — check `tail` is whitespace only).
2. `secret_get(key: String) -> Result<Option<String>, String>`, `secret_set(key: String, value: String)`, `secret_delete(key: String)` via `keyring` service `"app.noesis.desktop"`. Key must match `^[A-Za-z0-9._-]{1,100}$`. Missing entry → `None` / Ok. Never log values.
3. `attachment_write(fileName: String, bytes: Vec<u8>) -> Result<String, String>` writes to attachments dir as `<uuid>-<sanitized name>` (strip `<>:"/\|?*` and control chars, max 120 chars), write to temp file then rename (atomic). Return the key (file name only). Max 200 MB.
4. `attachment_read(key: String) -> Result<Vec<u8>, String>`, `attachment_delete(key: String) -> Result<(), String>`. Validate key: no path separators, no `..`, must resolve inside attachments dir (canonicalize + starts_with).
5. `export_write(path: String, bytes: Vec<u8>) -> Result<(), String>`: path must be absolute, parent dir must exist, extension in an allow-list (`md, html, pdf, json, csv, txt, wav, mp3, noesisbak, zip`). Atomic write (temp + rename).
6. `import_read(path: String) -> Result<Vec<u8>, String>`: absolute path, file ≤ 200 MB, extension allow-list `noesisbak, zip, md, json`.
7. `app_info() -> AppInfo { dataDir, version, dbPath, dbBytes, attachmentsBytes }` (camelCase serde rename).
8. `db_integrity() -> Result<Vec<String>, String>` runs `PRAGMA integrity_check`.
9. `db_snapshot(path: String)` — runs `VACUUM INTO ?` to an absolute path with `.db` extension (for native DB backup).

Startup: if opening the DB fails or `PRAGMA quick_check` != "ok", rename the corrupt file to `noesis.db.corrupt-<timestamp>` and start with a fresh DB; expose that via `app_info` field `recoveredFrom: Option<String>`.
Register plugins: single-instance (focus existing window), http, dialog, notification, opener.

## Tests
`src-tauri/src/lib.rs` (or `db.rs`) must have `#[cfg(test)]` unit tests: FTS5 available, param/row conversion round-trip, key validation rejects `../x` and `a/b`, file name sanitizing, export extension allow-list.
Run `cargo test` in `src-tauri` and make it pass. Then run `cargo build` (debug) to verify it compiles.

## Done when
`cargo test` passes and `cargo build` succeeds. Write a short summary of what you did and the exact test output into `src-tauri/AGENT_REPORT.md`. Do not commit.
