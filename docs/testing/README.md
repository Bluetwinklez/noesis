# Testing

Latest local verification (2026-10-28, Windows, Node 24.20.0, Rust 1.99.1): **105 Vitest tests / 15 files**, **20 Playwright scenarios**, **20 Rust tests**, strict Clippy and the benchmark suite passed. The table below retains earlier evidence. [Studio source coverage](studio-context.md) documents the new regression tests, bounded condensation, transfer behavior and limitations.

| Layer | Command | Recorded result (2026-10-27; environments below) | Covers |
|---|---|---|---|
| Typecheck | `npm run typecheck` | clean | whole TS codebase |
| Unit + integration (Vitest, `node:sqlite`) | `npm test` | 78 passed / 11 files, Linux Node 24 | migrations (v1–v4), transactions, restart persistence, pages, databases, two-way relations and rollups, tasks and recurrence, backup/restore, AI failures, ingestion, retrieval and citations, MCP tools and approvals, web clips, Notion/Obsidian import, DOCX and PDF export (real PDF read back with pdf.js) |
| Rust (`cargo test`) | `cd src-tauri && cargo test` | 17 passed | SQLite FTS5, typed params, transactions over IPC, SQL authorizer, path traversal, export path restriction, atomic writes, corrupt-DB quarantine, SSRF address checks, MCP endpoint auth/origins/CORS, stdio bridge, client config merge + backup |
| E2E (Playwright, browser preview) | `npx playwright test` | 16 passed | see below |

## E2E scenarios

The scenarios run against the real UI in browser-preview mode (SQLite WASM persisted to IndexedDB). AI calls go to `scripts/mock-ai-server.mjs`.

1. Create nested formatted pages that survive a restart (page reload = new process for the WASM store)
2. Import a PDF, inspect extracted text and find it in search
3. Source-grounded notebook answer with navigable citations
4. Invalid API key produces a recoverable error
5. AI edits are previewed and only applied after acceptance
6. Backup export and restore
7. Local editing keeps working offline (`context.setOffline(true)`)
8. Audio overview with a TTS-capable provider
9. Command palette, keyboard shortcuts, trash and restore
10. Pasting plain-text markdown creates structured blocks
11. Import a Notion export with nested pages, links and a database
12. Quick capture saves a note to the Inbox
13. Images and scanned PDFs are read with offline OCR, without an AI provider
14. Database timeline view shows dated rows and persists
15. Two-way relation keeps both sides linked and a rollup sums linked rows
16. A page exports straight to a PDF file

Benchmarks: `npm run bench`. See [benchmarks.md](benchmarks.md).

Desktop smoke test (manual, recorded): the release binary under Xvfb survived a SIGKILL and restart with content intact. Screenshots are in `evidence/`.

## What the automated suites do NOT cover

- The desktop shell end to end (Rust IPC + WebView2). `cargo test` covers the Rust side, and the TypeScript drivers share one interface. However, no automated test drives the packaged `.exe`.
- Real AI providers (only the mock server is used).
- The web clipper extension inside a real browser toolbar. Its capture function was exercised against a sample page; the endpoint side (origin/CORS/key) is covered by `cargo test`.
- A real auto-update (needs the signing secret and two published builds).
- Interactive Windows 10/11 installation and full packaged UI workflows. CI separately smoke-tests silent install, process lifetime, database creation and uninstall on Windows Server; this is narrower evidence than an interactive desktop test.

## Fixtures

`tests/fixtures/` contains valid and malformed files: `sample.pdf`, `truncated.pdf`, `fake.pdf`, `sample.docx`, `corrupt.docx`, `sample.png`, `broken.png`, `sample.md`, `sample.html`, `sample.csv`, `sample.txt` and `empty.txt`. Regenerate them with `node scripts/make-fixtures.mjs`.

## Environment notes

- Linux: Playwright uses bundled Chromium. Set `PW_CHROMIUM_PATH` to reuse a preinstalled binary whose revision differs from the Playwright version.
- Windows: the default channel is `msedge`.
- `node:sqlite` is loaded with `process.getBuiltinModule` so that jsdom-environment suites can use it under Vite's module runner.
- Local native compilation on the Windows development machine is blocked by Application Control (`os error 4551`). Native Rust and installer results are recorded from GitHub Actions, not inferred from browser tests.

## README screenshots

`npm run screenshots` captures the English built-in sample workspace at 1440×960 into `docs/images/`. The capture script verifies editor content, selected notebook sources, board records and dark mode before saving each image. No real keys or user documents are used. These are browser-preview images, not native Windows installation evidence.
