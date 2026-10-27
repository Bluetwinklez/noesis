# Noesis

Noesis is a local-first knowledge workspace for Windows. It combines a block-based note editor, structured databases, tasks and a knowledge graph with AI research notebooks that answer questions from your own sources and cite them.

It is built with Tauri 2 (Rust), React, TypeScript and SQLite. Notes and metadata are stored on your computer. Note-taking, search, databases and tasks work offline and without an AI provider.

> **Status: v0.1.0, pre-release.** The Windows installer builds in CI but is **unsigned** (SmartScreen will warn). AI providers have been tested only against a mock server. The evidence for every feature is in [`docs/implementation-status.md`](docs/implementation-status.md).

## Download

**[⬇ Download the latest release](https://github.com/Bluetwinklez/noesis/releases/latest)**: get `Noesis_<version>_x64-setup.exe` (Windows 10/11 x64).

1. Run the installer. It installs only for the current user and needs no admin rights.
2. Windows SmartScreen will show "Windows protected your PC" because the installer is **not code-signed**. Choose **More info → Run anyway**.
3. Optional: verify the file against `SHA256SUMS.txt` in the release with `Get-FileHash .\Noesis_0.1.0_x64-setup.exe -Algorithm SHA256`.

If **Smart App Control** is on, Windows may block unsigned apps entirely. That is a signing limitation, not an app defect.

Development builds from every push are also available as the `noesis-windows-x64-unsigned` artifact on the [Actions](https://github.com/Bluetwinklez/noesis/actions) tab (GitHub login required).

## Features

| Area | What exists |
|---|---|
| Editor | Tiptap/ProseMirror blocks: headings H1–H6, lists, checklists, quotes, callouts, code (syntax highlight), tables, images, files, bookmarks, toggles, math (KaTeX), page mentions; slash menu, markdown shortcuts, **markdown paste**, drag handle, block menu, undo/redo, autosave with version history |
| Pages | Multiple workspaces, nested pages, icons/covers, tags, favorites, pins, templates, archive, trash/restore, backlinks; Markdown import/export, HTML export, PDF via the print dialog |
| Databases | 11 property types (incl. relation, status, formula); table, board, calendar, list and gallery views; sort/filter/group; saved views |
| Tasks | Subtasks, due dates, priority, status, project link, daily/weekly/monthly/yearly recurrence, local reminders, convert a note block into a task |
| Research | Sources: PDF, DOCX, TXT, MD, HTML, CSV, web URLs, pasted text; images (OCR) and audio (transcription) through a capable AI provider. Staged ingestion pipeline with per-stage status and clear errors |
| AI | OpenAI, Gemini, Anthropic, Ollama and any OpenAI-compatible server. Hybrid RAG (FTS5 + vectors + RRF); citations are validated in code; answers say when the sources do not support them; streaming and cancel. Writing actions show a preview and change nothing until you accept. Study guide, FAQ, briefing, timeline, flashcards, quiz, document comparison |
| Audio | Audio overviews: single speaker, or two speakers where the provider supports it; transcript, speed control, WAV export |
| Search | Keyword / full-text / semantic / hybrid across pages, documents, databases, tasks and notebooks. Works offline |
| Graph | Interactive force graph of pages, documents, tags and approved semantic links |
| Platform | Light/dark/system themes, accent colours, resizable sidebar, Ctrl+K command palette, English and Turkish UI, 7-step onboarding, backup/restore (ZIP + SHA-256 manifest), API keys in Windows Credential Manager, consent prompt before content goes to a cloud AI |

## Quick start (development)

Requirements: Node.js 22.5+ (24 recommended), Rust stable. On Windows you also need the Visual Studio 2022 Build Tools (C++ workload) and WebView2. On Linux you need the [Tauri system packages](https://v2.tauri.app/start/prerequisites/).

```bash
npm ci
npm run dev          # browser preview at http://localhost:1420 (SQLite WASM + IndexedDB)
npx tauri dev        # desktop app
npx tauri build      # installers → src-tauri/target/release/bundle/
```

To try the AI features without an API key, run `node scripts/mock-ai-server.mjs 11435`. Then choose "OpenAI-compatible" in Settings with URL `http://127.0.0.1:11435/v1` and key `test-key`. See [AI configuration](docs/ai-configuration.md).

## Tests

| Command | What it covers | Last result |
|---|---|---|
| `npm run typecheck` | whole TypeScript codebase | clean |
| `npm test` | Vitest unit + integration (DB, pages, databases, tasks, backup, AI errors, ingestion, RAG, i18n) | 52 passed |
| `npx playwright test` | 10 end-to-end user flows in the browser preview | 10 passed |
| `cd src-tauri && cargo test` | Rust core (needs `npm run build` first) | 10 passed |
| `npm run bench` | search/autosave/chunking benchmarks → [benchmarks](docs/testing/benchmarks.md) | — |

CI runs everything on Linux and Windows, builds the installers, and installs, launches and uninstalls the app on a Windows runner. Details are in [docs/testing](docs/testing/README.md).

## Known limitations

- **Unsigned installer, no auto-update.** Download new versions manually.
- **AI adapters are untested against the live OpenAI, Gemini and Anthropic APIs.** Only the mock server has been used.
- No cloud sync. No YouTube import (rejected explicitly). OCR needs an AI provider. PDF export uses the print dialog.
- Offline semantic search uses lightweight hashed vectors, which are much weaker than a real embedding model.
- Security trade-offs (generic SQL over IPC, hostname-only SSRF guard) are listed in [privacy & security](docs/security/privacy-security.md).

## Roadmap: suggested next features

Ordered by value for effort:

1. **Verify real AI providers.** Do a manual test pass with real keys and fix adapter differences. Without this, the AI features are unproven.
2. **Local embedding model** (e.g. a small ONNX model run in the app). Semantic search and RAG would work well offline and without sending text to the cloud.
3. **Offline OCR** (Windows.Media.Ocr or Tesseract) for scanned PDFs and images, with no AI provider needed.
4. **Code signing + auto-update** (`tauri-plugin-updater`). Removes the SmartScreen warning and gives one-click updates. Needs a certificate.
5. **Direct PDF export** and DOCX export, without the print dialog.
6. **Narrower IPC surface.** Replace the generic `db_exec` with typed commands. Resolve URL hosts in Rust to block DNS-rebinding SSRF.
7. **Database upgrades:** timeline view, rollups, two-way relations, CSV import into a database.
8. **Web clipper** and a global quick-capture shortcut.
9. **Sync** (CRDT-based, e.g. Yjs, to a user-chosen folder or server). The architecture leaves a seam for it, but none of it is written.
10. **macOS/Linux builds.** The Linux build already works (`.deb`). macOS needs a Mac runner and signing.

## Documentation

- [Architecture](docs/architecture/README.md) · [Database schema](docs/architecture/database-schema.md)
- [AI configuration](docs/ai-configuration.md) · [Privacy & security](docs/security/privacy-security.md)
- [Testing](docs/testing/README.md) · [Benchmarks](docs/testing/benchmarks.md) · [Research (REA)](docs/research/README.md)
- [Releases](https://github.com/Bluetwinklez/noesis/releases) · [Release notes v0.1.0](docs/releases/v0.1.0.md) · [Releasing](docs/releases/README.md) · [Implementation status](docs/implementation-status.md)

## Independence

Noesis is an original implementation inspired by publicly documented product concepts. It contains no code, assets, branding or private APIs from Notion or Google NotebookLM. It is not affiliated with either.
