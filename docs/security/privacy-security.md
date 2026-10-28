# Privacy & security

## Data location

| Data | Desktop location |
|---|---|
| Database | `%APPDATA%\app.noesis.desktop\noesis.db` (SQLite) |
| Attachments, imported files, audio | `%APPDATA%\app.noesis.desktop\attachments\` (stable keys, atomic writes) |
| API keys | Windows Credential Manager (`keyring` crate) |
| Backups | Only where the user saves them (`.noesisbak` ZIP with a SHA-256 manifest) |

Settings → Storage and Settings → Diagnostics show the actual paths and sizes (`app_info`).

Nothing leaves the machine unless the user configures an AI provider, consents to sending content to it, or imports a web URL. There is no telemetry and no cloud sync.

## Controls implemented

| Requirement | Implementation | Evidence |
|---|---|---|
| Secure API key storage | OS keyring on desktop; keys excluded from DB/backups | `src-tauri/src/lib.rs` `secret_*`; `src/core/backup.ts` `BACKUP_TABLES` excludes secrets |
| No secrets in logs | Errors are mapped to `AiError` messages without headers or keys; the Rust side never logs secret values | `src/ai/providers.ts` `toAiError` |
| Strict Tauri permissions | One capability file, least-privilege plugin permissions, HTTP scope limited to `https://*` plus loopback, `*.local` denied | `src-tauri/capabilities/default.json` |
| CSP | `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `connect-src` limited to IPC (HTTP goes through the scoped plugin) | `src-tauri/tauri.conf.json` |
| File path validation | Attachment keys reject traversal; exports go through a Rust-owned save dialog (`export_save`), the chosen path must be absolute with an existing parent folder, and executable/script types (`.exe`, `.bat`, `.ps1`, `.lnk`, `.hta`, … including Windows' trailing-dot tricks) are refused; writes are atomic (temp + fsync + rename). The WebView never passes a file path to Rust | `src-tauri/src/files.rs` + tests |
| Import of archives | Zip imports are capped (20,000 files, 300 MB per entry, 2 GB in total, checked against declared sizes before unpacking); archive paths are only used as names, never as file-system paths; `tasks.json`/`sources.json`/manifest values are type-checked and clamped to what the database accepts | `src/import/importer.ts` + `tests/unit/export.test.ts` |
| CSV export | Cells that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab, CR) get a leading `'` (CSV injection); plain numbers are untouched and Noesis' own import removes the prefix | `src/export/exporter.ts` |
| Binary IPC | Attachments, exports and fetched pages cross the IPC bridge as raw bytes with a length-checked JSON header (no JSON number arrays) | `split_binary` in `src-tauri/src/lib.rs` + tests |
| Safe document parsing | Size cap (80 MB), magic-byte validation, pdf.js with no eval, mammoth for DOCX, malformed fixtures tested | `src/ingestion/extractors.ts`, `tests/integration` |
| Web content sanitisation | DOMPurify with scripts/styles/iframes/forms forbidden; clipped pages (web clipper) are sanitized the same way plus inputs/SVG/media | `htmlToText`, `sanitizeHtml` + `tests/unit/mcp.test.ts` |
| SSRF-safe URL import | Rust resolves the host, refuses private/loopback/link-local/CGNAT/multicast addresses, pins the checked IP for the connection and re-checks every redirect (max 5), 25 MB cap, no proxy | `src-tauri/src/net.rs` + tests |
| Guarded SQL bridge | `db_exec` runs behind an SQLite authorizer: no ATTACH/DETACH, no `load_extension`, no `writable_schema`/`journal_mode`/directory pragmas, no `VACUUM INTO`; internal maintenance uses an explicit unguarded scope | `src-tauri/src/db.rs` test `file_system_escapes_are_refused` |
| MCP endpoint for AI assistants | Off by default; `127.0.0.1` only; 64-hex bearer key in a per-user file; requests with a web-page `Origin` are refused (DNS rebinding), browser-extension origins still need the key; editing existing pages requires an in-app approval; workspace-scoped, trash excluded | `src-tauri/src/mcp.rs`, `src/mcp/server.ts` + tests |
| Signed updates | Updates are verified against the minisign public key in `tauri.conf.json` before install; the private key is only a GitHub secret | `src-tauri/tauri.conf.json`, `.github/workflows/release.yml` |
| Prompt-injection resistance | Sources are wrapped as untrusted DATA; the system prompt forbids following instructions found inside them; AI output never executes tools or actions; edits go through a preview that the user must accept | `src/ai/rag.ts` `buildGroundedPrompt`, `src/features/ai/AiPreview.tsx` |
| Consent before cloud upload | Per-provider consent dialog (once / always); revocable; background jobs never prompt | `src/app/services.ts` |
| Corruption detection | Startup quick-check; failed databases stay in place for independent recovery. A restore validates integrity/foreign keys in staging and preserves original files before installation | `src-tauri/src/lib.rs`, `src-tauri/src/recovery.rs`, [recovery tests](../testing/error-recovery.md) |
| Dependency checks | `npm audit` (high severity, production deps) and `cargo audit` in CI | `.github/workflows/ci.yml` |

## Known limitations (honest list)

1. **Generic `db_exec` IPC command.** The WebView can still run SQL against the user's database (the logic lives in TypeScript). The authorizer now blocks the file-system escapes (ATTACH, extensions, VACUUM INTO, dangerous pragmas), so a compromised WebView can damage the database but not read or write other files through SQLite. Typed commands would narrow this further.
2. ~~`export_write` accepted a renderer-supplied path.~~ **Fixed:** it was replaced by `export_save`, which opens the native save dialog in Rust and writes only to the path the user picked. The renderer also lost the `dialog:allow-save` permission.
3. **`freezePrototype` is off** (`tauri.conf.json`), because some dependencies patch prototypes.
4. **Prompt-injection defence is prompt-based.** A model can still be manipulated into producing a misleading *answer*. It cannot act on that answer, and citations are checked against the retrieved chunks.
5. ~~No `cargo audit` in CI.~~ **Fixed:** CI runs `cargo audit`; three advisories in the updater's zip dependency were removed by disabling that feature.
6. **Installers are unsigned**, so Windows SmartScreen will warn.
7. ~~The URL import SSRF check matched only literal host names.~~ **Fixed:** fetching moved to Rust with DNS resolution, address pinning and per-redirect checks (see table).
8. **The database is not encrypted at rest.** Anyone with access to the Windows user account can read `noesis.db`. Use BitLocker/device encryption.
9. **The MCP key and the web clipper.** The same key authorises AI clients and the browser extension. Treat it like a password; turning AI connections off stops the endpoint.

## Reporting

This is a pre-release project. Report security issues privately to the repository owner rather than in a public issue.
