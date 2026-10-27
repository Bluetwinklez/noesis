# Testing

| Layer | Command | Count (last run 2026-10-27, Linux, Node 22.22) | Covers |
|---|---|---|---|
| Typecheck | `npm run typecheck` | clean | whole TS codebase |
| Unit + integration (Vitest, `node:sqlite`) | `npm test` | 51 passed / 6 files | migrations (incl. "newer schema" refusal), transactions, restart persistence (file DB reopened), pages CRUD/nesting/trash/backlinks/autosave snapshots, databases + views + formulas, tasks + recurrence, backup/restore + tamper detection, AI provider failure mapping, extraction of PDF/DOCX/MD/HTML/CSV/TXT, malformed fixtures, URL SSRF guard, hybrid retrieval, citation verification, "insufficient evidence" path |
| Rust (`cargo test`) | `cd src-tauri && cargo test` | 10 passed | SQLite FTS5 availability, typed params, transactions over IPC, path traversal, filename sanitising, export path restriction, atomic writes, corrupt-DB quarantine |
| E2E (Playwright, browser preview) | `npx playwright test` | 10 passed | see below |

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

Benchmarks: `npm run bench`. See [benchmarks.md](benchmarks.md).

Desktop smoke test (manual, recorded): the release binary under Xvfb survived a SIGKILL and restart with content intact. Screenshots are in `evidence/`.

## What the automated suites do NOT cover

- The desktop shell end to end (Rust IPC + WebView2). `cargo test` covers the Rust side, and the TypeScript drivers share one interface. However, no automated test drives the packaged `.exe`.
- Real AI providers (only the mock server is used).
- Installer install/uninstall.

## Fixtures

`tests/fixtures/` contains valid and malformed files: `sample.pdf`, `truncated.pdf`, `fake.pdf`, `sample.docx`, `corrupt.docx`, `sample.png`, `broken.png`, `sample.md`, `sample.html`, `sample.csv`, `sample.txt` and `empty.txt`. Regenerate them with `node scripts/make-fixtures.mjs`.

## Environment notes

- Linux: Playwright uses bundled Chromium. Set `PW_CHROMIUM_PATH` to reuse a preinstalled binary whose revision differs from the Playwright version.
- Windows: the default channel is `msedge`.
- `node:sqlite` is loaded with `process.getBuiltinModule` so that jsdom-environment suites can use it under Vite's module runner.
