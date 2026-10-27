# Noesis

Noesis is a local-first knowledge workspace for Windows. It combines a block-based note editor, structured databases, tasks and a knowledge graph with AI research notebooks that answer questions from your own sources and cite them.

It is built with Tauri 2 (Rust), React, TypeScript and SQLite. Notes and metadata are stored on your computer. The note-taking features work offline and without an AI provider.

> **Status: v0.1.0, pre-release.** For each feature's state and the evidence behind it, see [`docs/implementation-status.md`](docs/implementation-status.md). The Windows installer is **unsigned**.

## Features

| Area | What exists |
|---|---|
| Editor | Tiptap/ProseMirror blocks: headings H1–H6, lists, checklists, quotes, callouts, code (syntax highlight), tables, images, files, bookmarks, toggles, math (KaTeX), page mentions, slash menu, markdown shortcuts, drag handle, undo/redo, autosave with snapshots |
| Pages | Multiple workspaces, nested pages, icons/covers, tags, favorites, templates, trash/restore, backlinks; Markdown/HTML/PDF (print) export |
| Databases | Text, number, date, checkbox, select, multi-select, URL, relation, status and formula properties; table, board, calendar, list and gallery views with sort/filter/group; saved views |
| Tasks | Subtasks, due dates, priority, status, project link, recurring tasks, local reminders, convert note blocks to tasks |
| Research | Sources: PDF, DOCX, TXT, MD, HTML, CSV, web URLs; images (OCR) and audio (transcription) through a capable AI provider. Staged ingestion pipeline with per-stage status |
| AI | OpenAI-compatible (incl. Ollama/LM Studio), Gemini and Anthropic providers; hybrid RAG (FTS5 + vectors + RRF), verified citations, "not supported by sources" answers, streaming and cancel; writing actions with preview-before-apply; study guides, FAQ, flashcards, quizzes, comparisons |
| Audio | Audio overviews (single speaker, or two speakers where the provider supports it), transcript, speed control, WAV export |
| Search | Keyword / full-text / semantic / hybrid across pages, sources, databases, tasks and notebooks; works offline |
| Graph | Interactive force graph of pages, sources, tags and approved semantic links |
| Platform | Light/dark/system themes, accent colours, resizable sidebar, Ctrl+K command palette, English and Turkish UI, onboarding, backup/restore (ZIP + SHA-256 manifest), Windows Credential Manager for API keys |

## Quick start (development)

Requirements: Node.js 22.5+ (24 recommended), Rust stable. On Windows you also need the Visual Studio 2022 Build Tools (C++ workload) and WebView2. On Linux you need the [Tauri system packages](https://v2.tauri.app/start/prerequisites/).

```bash
npm ci
npm run dev          # browser preview at http://localhost:1420 (SQLite WASM + IndexedDB)
npx tauri dev        # desktop app
```

## Tests

```bash
npm run typecheck
npm test                         # Vitest unit + integration
npx playwright test              # E2E against the browser preview; starts a mock AI server
cd src-tauri && cargo test       # Rust core (needs ../dist, run `npm run build` first)
```

On Linux the E2E tests use Chromium. If a Chromium binary is already installed, set `PW_CHROMIUM_PATH` to use it. On Windows they default to Edge (`PW_CHANNEL` overrides this). See [`docs/testing/README.md`](docs/testing/README.md).

## Building the Windows installer

```bash
npx tauri build      # → src-tauri/target/release/bundle/{nsis,msi}/
```

CI builds unsigned NSIS and MSI installers with SHA-256 checksums on `windows-latest` (see [`.github/workflows`](.github/workflows)). Release steps and the signing limitation are in [`docs/releases/README.md`](docs/releases/README.md).

## Documentation

- [Architecture](docs/architecture/README.md) · [Database schema](docs/architecture/database-schema.md)
- [AI configuration](docs/ai-configuration.md) · [Privacy & security](docs/security/privacy-security.md)
- [Testing](docs/testing/README.md) · [Research (REA)](docs/research/README.md)
- [Release notes v0.1.0](docs/releases/v0.1.0.md) · [Implementation status](docs/implementation-status.md)

## Independence

Noesis is an original implementation inspired by publicly documented product concepts. It contains no code, assets, branding or private APIs from Notion or Google NotebookLM. It is not affiliated with either.
