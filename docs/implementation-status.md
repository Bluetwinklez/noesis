# Implementation status

Last updated: 2026-10-28 · Version 0.1.x (continuous builds) · Machine-readable block at the end.

Status values: `done` (implemented and covered by an automated test or recorded evidence) · `partial` · `not-started` · `blocked`.

## Verification runs (this revision)

### Long-source Studio context (2026-10-28)

- Long sources are split into parts of at most 40,000 characters (approximately 10,000 tokens using the application's estimate). Up to 16 evenly spaced parts, including the final part, are condensed by the configured provider. Omitted sections and overlong provider summaries are reported explicitly.
- Integer fair sharing redistributes unused short-source space. Serialized source context, including escaped titles and wrappers, stays within its character budget; there is no per-source minimum that can overflow it. Actual provider token counts can differ from this estimate.
- The shared preparation path covers all Studio documents, flashcards, quizzes and audio scripts. It checks cancellation between provider calls and reports progress and per-source coverage. Summaries are paraphrases; condensed citations link to the original source without fabricated quote offsets.
- Studio note coverage persists in existing note JSON, backups and workspace ZIP round trips. ZIP imports recreate notebooks/notes and remap source identities. Audio generation displays coverage for the current session; existing saved audio records do not gain a coverage field.
- Regression-first evidence: the original code failed all three tests for a final-document fact reaching the generation request, 50-source context budgeting (42,279 characters for an 8,000-character budget), and cancellation between map calls. The corrected path passed them. Additional tests cover fair sharing, capped partial coverage, all generation paths, source numbers, oversized summaries, untrusted wrapper-shaped text and metadata transfer.
- Windows, Node 24.20.0, Rust 1.99.1: `npm ci` and typecheck passed; **105 Vitest tests / 15 files**, **20 Playwright scenarios**, **20 Rust tests**, strict `cargo clippy -- -D warnings` and the existing benchmark suite (**1 test**) passed. The final Playwright run used frozen sources; an earlier run affected by editing during Vite HMR was discarded. Production build passed. C++ Build Tools were installed by the owner; native test compilation now works locally.
- Measured on this Windows machine while native checks were running: 2,000-page full-text search median **15.850 ms**, hybrid search median **91.262 ms** (p95 **229.045 ms**). These are existing baseline benchmarks, not the large-data acceptance workload from plan item 5. These are mock-provider results, not live-service verification.

### Feature round 2 (PR #2)

| Check | Environment | Result |
|---|---|---|
| `npm run typecheck`, `npm run build` | Linux, Node 24 | clean; startup chunk ≈ 455 kB, exporters/OCR/MCP load lazily |
| `npm test` (Vitest) | Linux | **78 passed / 11 files** |
| `cargo test` | Linux, Rust stable | **17 passed** (SQL authorizer, SSRF fetch, MCP endpoint/bridge/client config, extension origins) |
| `npx playwright test` | Linux, Chromium | **16 passed** (+ Notion import, quick capture, offline OCR, timeline, relations/rollups, PDF export) |
| `cargo audit` | Linux | 0 vulnerabilities after dropping the updater plugin's zip feature |
| Desktop app under Xvfb | Linux, WebKitGTK | Updater settings, MCP toggle + one-click client connect, stdio bridge (tools/list, search, create_page), approval dialog, bridge auto-launching the closed app, global quick-capture shortcut |

### Release preparation update

- Windows, Node 24: **57/57 unit/integration tests**, **7 files**; TypeScript and production frontend build passed. Production dependency audit reported zero vulnerabilities.
- Windows, Edge: **10/10 browser end-to-end workflows passed** after the backup changes, including export/restore, offline editing and source-grounded notebook flows against the mock provider.
- README screenshot capture passed: four real English sample-workspace screens in `docs/images/`. Browser preview is explicitly identified in the captions.
- Backup creation now reads one consistent database snapshot and fails if a referenced attachment is unavailable. Restore validates formats, table counts and attachment presence/size/checksums before replacing data. Foreign keys stay enabled with transaction-local deferral. Cancelling the safety backup cancels restore.
- Local native compilation remains blocked by Application Control error 4551. The version-tag pipeline runs native tests and the installer smoke test on a Windows runner before publishing assets.
- Existing evidence below belongs to earlier development-branch revisions. It is retained with its original environment attribution.

| Check | Environment | Result |
|---|---|---|
| `npm run typecheck` | Linux, Node 22.22 | clean |
| `npm test` (Vitest) | Linux | **52 passed / 6 files** (+ `npm run bench`: 1 benchmark file) |
| `cargo test` | Linux, Rust 1.97 | **10 passed** |
| `npx playwright test` | Linux, Chromium 153 | **10 passed** |
| `npm run build` | Linux | OK; startup chunk 429 kB (was 1.43 MB) |
| `npx tauri build --bundles deb` | Linux | OK, `Noesis_0.1.0_amd64.deb` 6.4 MiB (release profile, LTO) |
| Desktop smoke test (release binary under Xvfb, WebKitGTK) | Linux | onboarding → sample content → formatted page → **SIGKILL** → relaunch → content intact, `PRAGMA integrity_check = ok`. Screenshots: `docs/testing/evidence/linux-desktop-*.jpg` |
| `npx tauri build` (NSIS/MSI) | Windows (GitHub Actions `windows-latest`, run 40470153557) | **OK.** `Noesis_0.1.0_x64-setup.exe` 5.11 MiB (`4b150f0c…49d5`), `Noesis_0.1.0_x64_en-US.msi` 6.00 MiB (`c078c95d…311f`), `Noesis_0.1.0_x64_tr-TR.msi` 6.00 MiB (`3f0b3fa0…1401`). Unsigned. Rust tests passed on Windows in the same job |
| Silent install → launch → DB created → uninstall | Windows CI (run 40472693052, `windows-latest`) | **PASS.** `Running (pid 8972); database: 4096 bytes` → `Install / launch / uninstall OK`. Installer `Noesis_0.1.0_x64-setup.exe` SHA-256 `7af8304b…cd926` |

## Acceptance scenarios (spec §27)

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Install and launch the Windows application | **PASS (automated)** | Windows CI silently installs the app, it runs for 20 s, the Rust core creates `%APPDATA%\app.noesis.desktop\noesis.db`, and uninstall removes the program. Runner is Windows Server; no interactive check on a desktop Windows 10/11 PC yet |
| 2 | Create a workspace and nested page | PASS | E2E `create nested formatted pages…`; desktop smoke test (workspace "Desktop Smoke") |
| 3 | Write formatted content | PASS | Same E2E (H1, bold, bullets, checklist); desktop smoke test (H1 + bold) |
| 4–5 | Close and reopen; content preserved | PASS (browser preview, Node, Linux desktop) / BLOCKED on Windows | E2E reload; unit test `keeps pages and content after closing and reopening the database file`; desktop SIGKILL + restart screenshots |
| 6 | Import a PDF and inspect extracted text | PASS | E2E `import a PDF…` (text, page count; malformed PDF rejected visibly) |
| 7 | Create an AI notebook using that PDF | PASS (mock AI) | E2E `source-grounded notebook answer…` |
| 8 | Source-grounded answer with navigable citations | PASS (mock AI) | Same E2E: citation opens the source with a highlighted excerpt; fabricated `[9]` removed |
| 9 | Edit an AI-generated note | PASS (mock AI) | Same E2E (Studio → Summary → Edit → Save) |
| 10 | Search across pages and imported documents | PASS | E2E: one query returns both the page and a "Document passage" |
| 11 | Export and restore a backup | PASS | E2E `backup export and restore`; unit tests for round-trip and tamper detection |
| 12 | Edit offline | PASS | E2E `local editing keeps working offline` |
| 13 | Invalid API key → recoverable error | PASS (mock AI) | E2E + unit `maps an invalid API key…`; the key is not echoed |
| 14 | Audio overview with a supported provider | PASS (mock TTS) / unverified with a real provider | E2E `audio overview with a TTS-capable provider` |
| 15 | Build the Windows installer and validate the installation | **PASS (automated)** | Build, install, launch and uninstall on Windows CI. A manual check on a real Windows 10/11 PC (SmartScreen, Start menu, UI) is still recommended |

## Features

| Area | Status | Notes |
|---|---|---|
| App shell, 12 navigation areas, Ctrl+K palette, breadcrumbs, recents, pinned, back/forward | done | |
| Themes (light/dark/system), 8 colour palettes, accent colours, resizable and collapsible sidebar | done | Native Windows title bar (decorations on); no custom title bar |
| Editor blocks and marks (spec §9 list) | done | |
| Slash menu, markdown shortcuts, drag handle, block menu, undo/redo | done | |
| Markdown paste → blocks | done | Added in this revision (unit + E2E) |
| Autosave + snapshots, crash-safe persistence | done | Linux desktop SIGKILL test |
| Markdown import/export, HTML export, Word (.docx) export | done | DOCX via the `docx` package, native headings/lists/tables/images |
| Notion export / Obsidian vault import | done | Nested pages, internal links, CSV → databases, images (unit + E2E) |
| PDF export | done | Direct `.pdf` writer (pdfmake, embedded Roboto, selectable text). Emoji/CJK need the Print path |
| Page templates, icons, covers | done | |
| Workspaces, nested pages, tags, favorites, archive/trash/restore | done | |
| Databases: 12 property types, 6 views (incl. timeline), sort/filter/group, saved views, formulas | done | Formula engine is a safe parser, not `eval` |
| Two-way relations and rollups | done | Paired properties kept in sync in one transaction; rollups computed, not stored (unit + E2E) |
| Tasks: subtasks, due, priority, status, project, recurring, reminders, block → task | done | Reminders use OS notifications while the app is running |
| Ingestion: PDF, DOCX, TXT, MD, HTML, CSV, URL | done | |
| Ingestion: images and scanned PDFs (OCR) | done | Offline Tesseract (eng + tur) shipped with the app; AI vision optional fallback. Not yet checked under the release CSP on Windows |
| Ingestion: audio | partial | Needs a transcription-capable provider |
| Ingestion: YouTube | not-started | Rejected with an explicit "not supported" error. No authorised transcript API is integrated |
| RAG: FTS5 + vectors + RRF + rerank, budgeting, history, provenance, citation verification, streaming, cancel | done | |
| AI providers: OpenAI-compat, Gemini, Anthropic, Ollama | partial | Tested against a mock server only, never against the live APIs |
| AI assistant actions incl. study guide, flashcards, quiz, compare, translate | done (mock) | Preview-before-apply enforced |
| Audio overviews | done (mock) | Multi-speaker only where the provider supports it; no interactive mode |
| Knowledge graph | done | Force layout; performance with very large graphs not benchmarked |
| Unified search (keyword/full-text/semantic/hybrid) | done | |
| Settings (all §21 sections) | done | |
| Onboarding (7 steps, AI skippable) | done | Two cosmetic issues fixed in this revision |
| i18n English + Turkish | done | |
| Backup/restore, integrity check, corrupt-DB quarantine | done | |
| Keyring secret storage | done | Linux/Windows backends compiled; Windows Credential Manager not verified on a real Windows host in this session |
| Cloud sync | not-started | No sync code; the architecture doc describes the seam |
| Quick capture (global shortcut, tray) | done | `Ctrl+Shift+Space` system-wide; notes go to an Inbox page |
| Web clipper (browser extension) | done | `extensions/web-clipper`, MV3; developer-mode install; not in stores |
| MCP server for AI assistants | done | 10 tools, approval for edits, one-click config for Claude Desktop/Cursor/Windsurf/LM Studio |
| Auto-update | done (config) | Tauri updater, minisign-signed, every push to `main` publishes a build. Needs the `TAURI_SIGNING_PRIVATE_KEY` secret; end-to-end update not yet observed |
| Code signing | blocked | No certificate |
| Performance benchmarks | partial | `npm run bench` covers search, autosave, chunking and embedding (`docs/testing/benchmarks.md`). It led to a vector-cache fix (hybrid search 236 → 37 ms). Packaged-app start-up and rendering are not measured |
| CI (GitHub Actions): Linux tests + E2E, Windows tests + installer + checksums; tag release | done (config) | Workflows were added in this revision. Their first run happens on push, so results are not yet known |
| REA research | partial | REA installed and verified, and used for self-analysis of the bundle. Competitor targets were blocked by the network policy. See `docs/research/` |

## Fixed in the audit round (2026-10-27, second pass)

- Knowledge graph: ResizeObserver callback after unmount threw `Cannot read properties of null (reading 'getBoundingClientRect')`
- Recurring tasks: a yearly task due on Feb 29 skipped to Mar 1; completing a done task again created a duplicate occurrence (both covered by tests)
- Security: exports now go through a Rust-owned save dialog (`export_save`). The renderer can no longer choose an arbitrary file to overwrite. Verified in the desktop app
- UI: the sidebar search placeholder wrapped and was clipped; "1 · Sources" now reads "1 source" (plural support in i18n); source type labels are localised (e.g. "NOTE" → "Not")

## Fixed in feature round 2

- Quick capture: Ctrl+Enter was ignored when the modal moved focus to its header (flaky CI); now handled window-wide with a double-save guard
- Release workflow: continuous builds had no release-notes file and would have failed to publish; notes are generated from commits
- URL fetching now resolves DNS in Rust, pins the checked address and re-checks every redirect (DNS-rebinding safe)
- `db_exec` runs behind an SQLite authorizer (no ATTACH, extensions, or schema/journal pragmas; no VACUUM INTO)

## Known defects / risks

1. `db_exec` still accepts SQL strings from the WebView (now authorizer-guarded). Typed commands would be stronger. See `docs/security/privacy-security.md`.
2. No real-provider AI test has been run.
3. The Windows installer has only been verified in CI, not interactively on a Windows 10/11 desktop. Tray icon and OCR under the release CSP are unverified on Windows.
4. Auto-update needs the signing secret; the first real update has not been observed yet.

```json
{
  "version": "0.1.0",
  "updated": "2026-10-28",
  "studio_long_sources": { "vitest": 105, "vitest_files": 15, "playwright": 20, "cargo": 20, "clippy": "PASS -D warnings", "benchmark_tests": 1, "environment": "Windows Node 24.20.0 Rust 1.99.1", "live_provider_verified": false },
  "tests": { "vitest": { "passed": 57, "failed": 0, "environment": "Windows Node 24" }, "cargo": { "passed": 10, "failed": 0, "scope": "previous development revision CI" }, "playwright": { "passed": 10, "failed": 0, "environment": "Windows Edge browser preview" } },
  "local_native_build": "Rust tests and strict Clippy passed locally; packaged installer not rebuilt in this run",
  "readme_screenshots": { "result": "PASS", "count": 4, "mode": "browser_preview_sample_data" },
  "acceptance": {
    "1": "PASS_AUTOMATED", "2": "PASS", "3": "PASS", "4": "PASS", "5": "PASS", "6": "PASS", "7": "PASS",
    "8": "PASS", "9": "PASS", "10": "PASS", "11": "PASS", "12": "PASS", "13": "PASS", "14": "PASS_MOCK", "15": "PASS_AUTOMATED"
  },
  "round2": { "vitest": 78, "cargo": 17, "playwright": 16, "environment": "Linux CI container" },
  "not_started": ["youtube_ingestion", "cloud_sync", "local_embedding_model", "db_encryption"],
  "partial": ["live_ai_provider_verification", "benchmarks_desktop", "rea_competitor_research", "auto_update_end_to_end"],
  "blocked": ["code_signing"],
  "manual_pending": ["interactive_install_on_windows_10_11"]
}
```
