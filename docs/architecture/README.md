# Architecture

## Overview

```
┌──────────────────────────── WebView2 (React 19 + TS) ─────────────────────────────┐
│ app/ (boot, zustand state, services)   components/ (ui kit, shell)   i18n/ en,tr │
│ features/ home · pages · notebooks · sources · databases · tasks · graph · search │
│           settings · onboarding · ai                                              │
│ editor/   Tiptap 3 + custom nodes (callout, mention, bookmark, file), md/html io  │
│ core/     Database (serialised queue, transactions) · migrations · repos ·       │
│           backup · formula engine                                                 │
│ ingestion/ pipeline · extractors · chunker      search/ FTS5 + vectors + RRF       │
│ ai/       providers (OpenAI-compat, Gemini, Anthropic) · rag · assistant          │
└────────────────┬──────────────────────────────────────────────────────────────────┘
                 │ Tauri IPC (narrow command set, see below)
┌────────────────▼──────────────── Rust core (src-tauri) ──────────────────────────┐
│ db.rs     rusqlite (bundled SQLite with FTS5), single connection, typed params    │
│ files.rs  attachment store: atomic writes, key validation, export path checks     │
│ lib.rs    commands, keyring (Windows Credential Manager), integrity check on      │
│           startup (corrupt DB moved aside), single-instance, plugins              │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Business logic (repositories, ingestion, RAG, search) is written once in TypeScript. It runs against a small `SqlDriver` interface with three implementations:

| Driver | Used by | Storage |
|---|---|---|
| `tauri-driver.ts` | Desktop app | SQLite file in the app data directory, through Rust (`db_exec`) |
| `wasm-driver.ts` | Browser preview, E2E tests | `@sqlite.org/sqlite-wasm` in memory, snapshotted to IndexedDB |
| `node-driver.ts` | Vitest | `node:sqlite` |

So the same SQL, migrations and repository code run under unit tests, E2E tests and the desktop app.

### Why the logic lives in TypeScript

- One implementation of the data layer, which all three test layers exercise.
- The browser preview gives fast, deterministic E2E tests without a native shell.
- Trade-off: the IPC surface includes a generic `db_exec` command. Any script running in the WebView can therefore read or write the user's database. The defences are a strict CSP (no remote scripts, no `eval`), DOMPurify on all untrusted HTML, and the absence of any remote content in the app origin. See [privacy-security.md](../security/privacy-security.md).

## Tauri commands

`db_exec`, `db_integrity`, `db_snapshot` (backup), `secret_get/set/delete` (OS keyring), `attachment_write/read/delete`, `export_write` (paths restricted, see `files.rs`), `app_info`. Plugins: http (for AI provider calls; scoped in `capabilities/default.json`), dialog, notification, opener, single-instance.

## Data flow

**Editing.** The Tiptap document is debounced and saved by `pages.saveContent`. In one transaction this updates `content_json` and `content_text`, rewrites `page_links` from mentions and links, refreshes the `search_index` row and occasionally adds a `page_snapshots` entry. The WASM driver flushes to IndexedDB after writes.

**Ingestion.** `IngestionPipeline`: import → validate (size, magic bytes) → extract (pdf.js, mammoth, DOMPurify, CSV parser, AI OCR/transcription) → normalise → chunk (with page and offset provenance) → embed (provider embeddings or the offline `local-hash-512` vectors) → index (FTS5 triggers + `search_index`). Every stage writes `status/stage/error` on the `sources` row. An unsupported or failed import ends in `error` with a message and is never reported as `ready`.

**Retrieval (RAG).** Retrieval runs FTS5 BM25 and cosine similarity over the selected sources, fuses the two rankings with reciprocal rank fusion and optionally reranks. It then packs chunks into a token budget. The prompt marks source text as untrusted data. The model must cite `[n]`. `resolveCitations` drops any citation number that does not map to a retrieved chunk. If nothing relevant is retrieved, the answer is the fixed "sources do not support this" message and no model call is made.

**AI writes.** Assistant actions never write directly. They open `AiPreview`, and content changes only after the user accepts the preview.

## Sync

There is no cloud sync. All data is local. The repository layer depends only on `Executor`, so a future sync engine would hook in at the repository write path. Change-log tables are not implemented, and nothing in the app claims sync exists.

## Directory layout

The spec suggested a multi-package monorepo (`apps/`, `packages/`). The project instead uses a single Vite app with top-level folders (`src/core`, `src/ai`, `src/ingestion`, `src/search`, `src/editor`, …). There is one product and one build, so workspace tooling would add build complexity without adding isolation. The folders have no circular dependencies on `features/`, so they can be extracted into packages later.
