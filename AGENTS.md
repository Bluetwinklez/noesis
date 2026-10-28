# Agent guide (Codex, Claude Code, others)

Noesis is a local-first Windows desktop knowledge workspace (Notion + NotebookLM style):
Tauri 2 (Rust) shell, React 19 + TypeScript UI, TipTap editor, SQLite (native via Rust,
SQLite WASM in the browser preview). Read [README](README.md),
[architecture](docs/architecture/README.md) and
[implementation status](docs/implementation-status.md) before changing anything.

## Commands (run all before every push)

```bash
npm ci
npm run typecheck          # tsc -b
npm test                   # Vitest unit/integration (90 tests at handoff)
npx playwright test        # E2E against the browser preview (19 tests at handoff)
                           # Linux sandbox without a matching browser: PW_CHROMIUM_PATH=/path/to/chrome
cd src-tauri && cargo test --locked && cargo clippy -- -D warnings   # 20 Rust tests
npm run bench              # performance benchmarks (vitest.bench.config.ts)
```

CI (`.github/workflows/ci.yml`) runs typecheck, Vitest, `npm audit`, Playwright on Linux and
`cargo test` + `tauri build` on Windows. Every push to `main` publishes a signed continuous
build `v0.1.N` through `release.yml` (the updater key is a GitHub secret).

## Layout

| Path | What |
| --- | --- |
| `src/core/` | Types, document model, repositories (`repos/`), migrations (`db/migrations.ts`, latest v5), backup |
| `src/app/` | App state (`state.ts`, `Prefs`), theme/services, boot, maintenance (auto backup, trash), updater |
| `src/editor/` | TipTap editor, Markdown/HTML/DOCX/PDF serialization |
| `src/export/`, `src/import/` | Full workspace export (.zip of Markdown/CSV/files + `Noesis data/`) and import |
| `src/ai/` | Providers, RAG, assistant |
| `src/features/` | UI per feature (pages, databases, tasks, notebooks, sources, settings, …) |
| `src/mcp/` + `src-tauri/src/mcp.rs` | Local MCP server and web clipper endpoint |
| `src/lib/platform.ts` | Tauri/browser abstraction, binary IPC (`packBinary`/`unpackBinary`) |
| `src-tauri/src/` | `lib.rs` commands, `db.rs`, `files.rs` (path validation, blocked extensions), `net.rs` |
| `extensions/web-clipper/` | MV3 browser extension |
| `tests/unit`, `tests/e2e` | Vitest and Playwright tests |

## Rules

- One feature per branch and per PR. Keep PRs small enough to review.
- Every feature ships with tests: unit tests for logic, a Playwright test for the user flow.
  A bug fix starts with a test that fails on the old code.
- Schema changes only through a new migration in `src/core/db/migrations.ts`, never edit an old one.
  Export/import (`exporter.ts`, `importer.ts`) and backup must keep round-tripping new data.
- Binary data between JS and Rust goes through the raw binary IPC (`packBinary`), not JSON arrays.
- Every user-chosen file path goes through `validate_user_path` in `files.rs`.
- HTML from outside (web pages, imports, AI output) goes through `sanitizeHtml` (DOMPurify).
- UI strings go into both English and Turkish in `src/i18n/`; check that a key does not exist already.
- New settings go into `Prefs` (`src/app/state.ts`) with a default and a migration in `loadSettings`.
- Never commit secrets: API keys, the updater private key, user documents.
- Do not present tests against the mock AI provider as live-provider verification.
- Write commit messages and docs in English. Update `docs/implementation-status.md` and
  `CHANGELOG.md` with each feature.

## State at handoff (2026-10-28)

Done: pages/editor, databases (views, formulas, two-way relations, rollups), tasks, notebooks
with sources and RAG, OCR, graph, search, web clipper, MCP server, DOCX/PDF/Markdown export,
full workspace export + import, automatic rotating backups (daily/weekly, keep N, Settings →
Storage), settings (General/Editor/Storage/AI/…), signed auto-updates, and one
"finish every write, then quit" path (`src/app/pendingWrites.ts`: delayed editor/title saves
register a flusher; closing the window, tray Quit and installing an update wait for them;
`Database.flushNow()` drains the statement queue).

Open PR: [#8](https://github.com/Bluetwinklez/noesis/pull/8) (settings, automatic backups,
dialog focus fix, save-before-quit, this file). Merge it before starting new work, then branch
from `main`.

## Plan (in priority order)

Reliability of what exists comes before new features. Each item is one PR; the acceptance
criteria define "done". Every claim below was checked against the code at handoff.

### 1. Long sources: Studio must not drop the end of a document

Problem: `studioContext()` in `src/ai/assistant.ts` sends only `text.slice(0, perSource)` of
each source, so conclusions at the end of long documents never reach the model. With many
sources the `Math.max(800, …)` floor makes the total exceed the budget. The same context feeds
summary/study guide/FAQ/timeline/briefing/comparison (`generateStudioDoc`), flashcards, quiz
and the audio script (`generateAudioScript`).

Do:
- Split the character budget fairly: sources shorter than their share keep everything, the
  rest share what is left; the total never exceeds the budget (no fixed floor).
- When a source is longer than its share, condense it map-reduce style: split into parts
  (~10k tokens each, a capped number of parts), ask the provider for a dense summary of each
  part (keep facts, numbers, names, conclusions; content is untrusted data), join the summaries
  and use that as the source text. Honour the abort signal between calls; report progress.
- Return coverage per source (characters total / characters represented, condensed or not)
  and show it in the Studio UI ("Long source condensed in 6 parts", or a warning when part
  of a source could not be covered).
- Citations still map to the original source number.

Done: unit tests with the mock provider prove (a) a fact placed only at the end of a long
source reaches the final prompt, (b) the total context stays within budget with 50 sources,
(c) abort stops the map step. E2E: Studio summary of a long source shows the coverage note.

### 2. Answers without sources must say so

Problem: `answerQuestion()` in `src/ai/rag.ts` returns `insufficient: true` when nothing was
retrieved or the model cited nothing, but `NotebookView.tsx` (`addMessage` after
`answerQuestion`) ignores it, so an uncited answer looks like a normal grounded answer. A
valid `[n]` also does not prove the cited text supports the claim.

Do:
- Store the flag with the message (migration: column on notebook messages, or a status
  value) and render a visible warning on such answers ("No source supports this answer").
- Mark sentences without any citation in otherwise cited answers (subtle style, tooltip).
- Add an evaluation harness under `tests/eval/` (not in the default `npm test`): a small set
  of question/source/expected-fact cases, scoring citation presence, citation correctness
  (the cited chunk contains the key terms of the claim) and refusal when the answer is not in
  the sources. It runs against the mock provider in CI and against a real provider when an
  API key is in the environment.

Done: unit tests for the flag and uncited-sentence detection; E2E: a question with no
matching source shows the warning; eval harness documented in `docs/testing/`.

### 3. Recover interrupted source processing at startup

Problem: `src/ingestion/pipeline.ts` sets a source to `processing`; if the app closes during
PDF/OCR it stays `processing` forever. `boot.ts` does nothing about it.

Do: at startup find sources still `processing` and either resume them (the original file is
in the attachment store) or mark them `error` with "Interrupted — retry"; the existing retry
action must work on them. Never run two pipelines for the same source.

Done: unit test (source left in `processing`, boot recovery resumes or flags it); E2E if
practical.

### 4. Error recovery UI

Problem: there is no React error boundary, so one render error blanks the whole app. When the
database cannot open, `src/main.tsx` says "restore a backup from Settings", but Settings is
unreachable in that state.

Do:
- An app-level error boundary plus one per main view (page, database, notebook, settings):
  shows the error, "Reload view", "Copy details", and keeps the sidebar usable.
- A standalone recovery screen when boot fails, independent of the normal app: restore from a
  backup file, open the automatic backups folder (desktop), export the raw database file,
  copy diagnostics. It must not need the database to be open.

Done: unit/E2E test that a throwing component shows the boundary and the rest still works;
E2E with a corrupted database (browser preview) shows the recovery screen and restoring a
backup brings the data back.

### 5. Large-data performance

Seed 5 000 pages, 50 databases × 2 000 rows, 1 000 sources (script under `scripts/`).
Measure app start, sidebar render, search latency, opening a 2 000-row table, export/import
time. Fix the worst offenders (virtualize long lists, add indexes via a migration, paginate).
Done: numbers in `docs/testing/`, start < 2 s, search < 200 ms, table open < 500 ms on CI
hardware; a bench test guards against regressions.

### 6. Daily notes + calendar

"Today" command and shortcut opens/creates the day's page under a "Daily notes" parent (title
format from a setting); a sidebar calendar shows days with notes and tasks due; template for
new daily pages. Done: unit tests for date/title logic, E2E for create-today and navigation.

### 7. Ask across all notebooks

RAG over every notebook's sources and the user's pages, citations open the exact source/page,
same insufficient-evidence warning as item 2. Done: retrieval ranking unit tests with the mock
provider; E2E for citation click-through.

### 8. Table of contents + tabs/split view

TOC block and side panel from headings; open pages in tabs (Ctrl+click), two pages side by
side; tabs persist across restarts. Every open tab must register its delayed saves with
`registerFlusher`.

### 9. Database encryption at rest (design note first)

Optional, off by default: SQLCipher or equivalent in the Rust layer, password in Settings →
Security, encrypted backups, migration from a plain database, a clear "forgotten password =
data lost" warning. Write `docs/security/encryption-design.md` and stop for review before code.

### 10. Sync between PCs (design note only)

The owner has not chosen an approach. Compare (a) a shared folder such as OneDrive with an
append-only change log and per-device files, and (b) a server; cover conflicts, attachments
and encryption. Do not implement until the owner picks one.

Later: mind map / canvas, column layout, comments, YouTube sources, local embedding model.

## Needs the owner, not an agent

- Live verification of OpenAI / Gemini / Claude / Ollama with real keys (the eval harness
  from item 2 makes this one command once a key is set).
- Confirming that auto-update and save-before-quit work on the owner's Windows PC: type,
  close within a second, reopen, the text must be there; same with the tray Quit and an update.
- A code-signing certificate (Windows "unknown publisher" warning).
- The sync approach decision.
