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
npm test                   # Vitest unit/integration (86 tests at handoff)
npx playwright test        # E2E against the browser preview (19 tests at handoff)
cd src-tauri && cargo test --locked && cargo clippy -- -D warnings   # 20 Rust tests
npm run bench              # performance benchmarks (vitest.bench.config.ts)
```

CI (`.github/workflows/ci.yml`) runs typecheck, Vitest, `npm audit`, Playwright on Linux and
`cargo test` + `tauri build` on Windows. Every push to `main` publishes a signed continuous
build `v0.1.N` through `release.yml` (the updater key is a GitHub secret).

## Layout

| Path | What |
| --- | --- |
| `src/core/` | Types, document model, repositories (`repos/`), migrations (`db/migrations.ts`, latest v4), backup |
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
full workspace export + import, backups with automatic rotation, settings
(General/Editor/Storage/AI/…), signed auto-updates.

Open PR: [#8](https://github.com/Bluetwinklez/noesis/pull/8) (more settings, automatic backups,
dialog focus fix). Merge it before starting new work, then branch from `main`.

## Plan (in priority order)

Each item is one PR. Acceptance criteria are what "done" means.

1. **Large-data performance.** Seed 5 000 pages, 50 databases × 2 000 rows, 1 000 sources
   (script under `scripts/`). Measure: app start, sidebar render, search latency, opening a
   2 000-row table, export/import time. Fix the worst offenders (virtualize long lists, add
   missing indexes via a migration, paginate queries).
   Done: numbers recorded in `docs/testing/`, start < 2 s, search < 200 ms, table open < 500 ms
   on CI hardware; a bench test guards against regressions.
2. **Daily notes + calendar.** "Today" command and shortcut opens/creates the page for the day
   under a "Daily notes" parent (title format from a setting); a calendar view in the sidebar
   shows days with notes and tasks due. Template support for new daily pages.
   Done: unit tests for date/title logic, E2E for create-today and calendar navigation.
3. **Ask across all notebooks.** RAG over every notebook's sources and the user's pages, with
   citations that open the exact source/page. Respect the existing provider settings.
   Done: unit tests for retrieval ranking with the mock provider; E2E for citation click-through.
4. **Table of contents + tabs/split view.** TOC block and side panel from headings; open pages
   in tabs (Ctrl+click), two pages side by side. Tabs persist across restarts.
5. **Database encryption at rest (optional, off by default).** SQLCipher or equivalent in the
   Rust layer, password in Settings → Security, encrypted backups. Needs a migration path for
   existing plain databases and a clear "forgotten password = data lost" warning.
   Write a short design note in `docs/security/` first and get it reviewed before coding.
6. **Sync between PCs (design only first).** The owner has not chosen an approach yet. Write a
   design note comparing (a) a shared folder such as OneDrive with an append-only change log
   and per-device files, and (b) a server. Cover conflicts, attachments and encryption. Do not
   implement until the owner picks one.

Later: mind map / canvas, column layout, comments, YouTube sources, local embedding model,
code signing (needs a certificate from the owner).

## Needs the owner, not an agent

- Live verification of OpenAI / Gemini / Claude / Ollama with real keys.
- Confirming that auto-update worked on the owner's PC (v0.1.x → latest).
- A code-signing certificate.
- The sync approach decision.
