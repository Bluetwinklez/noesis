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
| File path validation | Attachment keys reject traversal; export paths must be absolute, use an allow-listed extension and have an existing parent folder; writes are atomic (temp + fsync + rename) | `src-tauri/src/files.rs` + tests |
| Safe document parsing | Size cap (80 MB), magic-byte validation, pdf.js with no eval, mammoth for DOCX, malformed fixtures tested | `src/ingestion/extractors.ts`, `tests/integration` |
| Web content sanitisation | DOMPurify with scripts/styles/iframes/forms forbidden; URL import blocks private, loopback and link-local addresses (SSRF) | `htmlToText`, `validateUrl` |
| Prompt-injection resistance | Sources are wrapped as untrusted DATA; the system prompt forbids following instructions found inside them; AI output never executes tools or actions; edits go through a preview that the user must accept | `src/ai/rag.ts` `buildGroundedPrompt`, `src/features/ai/AiPreview.tsx` |
| Consent before cloud upload | Per-provider consent dialog (once / always); revocable; background jobs never prompt | `src/app/services.ts` |
| Corruption detection | `PRAGMA integrity_check` + `foreign_key_check` at startup; a corrupt file is moved aside instead of being overwritten | `src-tauri/src/lib.rs` tests `corrupt_database_is_moved_aside` |
| Dependency checks | `npm audit` in CI (high severity, production deps) | `.github/workflows/ci.yml` |

## Known limitations (honest list)

1. **Generic `db_exec` IPC command.** The WebView can run any SQL against the user's database. This is a deliberate design choice: the logic lives in TypeScript (see the architecture doc). Its safety depends on no attacker-controlled script ever running in the WebView. CSP and sanitisation reduce that risk but do not remove it.
2. **`export_write` can overwrite any existing file with an allow-listed extension** (`md`, `html`, `pdf`, `json`, `csv`, `txt`, `wav`, `mp3`, `noesisbak`, `zip`, `db`) at a path the renderer supplies. In normal use the path comes from the native save dialog, but the Rust side cannot verify that.
3. **`freezePrototype` is off** (`tauri.conf.json`), because some dependencies patch prototypes.
4. **Prompt-injection defence is prompt-based.** A model can still be manipulated into producing a misleading *answer*. It cannot act on that answer, and citations are checked against the retrieved chunks.
5. **No `cargo audit`** in CI yet.
6. **Installers are unsigned**, so Windows SmartScreen will warn.
7. **The URL import SSRF check matches only literal host names and IPs** (`localhost`, RFC 1918, link-local, loopback). A public host name that resolves to a private address (DNS rebinding) is not blocked.

## Reporting

This is a pre-release project. Report security issues privately to the repository owner rather than in a public issue.
