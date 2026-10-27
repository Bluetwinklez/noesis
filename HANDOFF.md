# Noesis maintainer handoff

Noesis is a Tauri 2 / React / TypeScript knowledge workspace. Start with the [README](README.md), [architecture](docs/architecture/README.md), and [implementation status](docs/implementation-status.md).

## Development

Use Node.js 24 and Rust stable. Windows native builds require Visual Studio C++ Build Tools and WebView2. Run `npm ci`, then `npm run dev` for browser preview or `npx tauri dev` for the desktop application. The browser preview uses SQLite WASM; the native shell uses Rust and SQLite with FTS5.

## Current release preparation

- Existing editor, search, task, graph and native export hardening is preserved from the development branch.
- Documentation and release notes are in English. The application retains English and Turkish interfaces.
- Real screenshots are captured from sample data with `npm run screenshots` and embedded in the README.
- Backup reads are consistent across tables. Missing attachments abort backup creation. Restore validates manifest, tables and attachments before replacing data, and keeps foreign key enforcement enabled. Cancelling the safety backup cancels restore.
- Local Node/TypeScript and browser checks are recorded in the implementation status. Native compilation on the local Windows machine is blocked by Application Control error 4551. Do not disable device policy to bypass it; use the Windows CI runner.
- Release tags validate matching package/Tauri/Cargo versions, run automated checks, build unsigned Windows installers, smoke-test installation and publish a pre-release with checksums.

## Remaining work

Live AI provider verification, code signing, automatic updates, direct PDF export, offline OCR, trained local embeddings and synchronization remain future work. Do not present mock-provider tests as live-provider verification. Keep user documents, API keys and signing credentials out of source control and reports.
