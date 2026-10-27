# Implementation status

Last updated: 2026-10-27 · Version 0.1.0 · Machine-readable block at the end.

Status values: `done` (implemented and covered by an automated test or recorded evidence) · `partial` · `not-started` · `blocked`.

## Verification runs (this revision)

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
| Themes (light/dark/system), accent colours, resizable and collapsible sidebar | done | Native Windows title bar (decorations on); no custom title bar |
| Editor blocks and marks (spec §9 list) | done | |
| Slash menu, markdown shortcuts, drag handle, block menu, undo/redo | done | |
| Markdown paste → blocks | done | Added in this revision (unit + E2E) |
| Autosave + snapshots, crash-safe persistence | done | Linux desktop SIGKILL test |
| Markdown import/export, HTML export | done | |
| PDF export | partial | Uses the system print dialog ("Save as PDF"), no direct PDF writer |
| Page templates, icons, covers | done | |
| Workspaces, nested pages, tags, favorites, archive/trash/restore | done | |
| Databases: 11 property types, 5 views, sort/filter/group, saved views, formulas | done | Formula engine is a safe parser, not `eval` |
| Tasks: subtasks, due, priority, status, project, recurring, reminders, block → task | done | Reminders use OS notifications while the app is running |
| Ingestion: PDF, DOCX, TXT, MD, HTML, CSV, URL | done | |
| Ingestion: images (OCR), audio | partial | Needs a vision- or transcription-capable provider; there is no offline OCR |
| Ingestion: YouTube | not-started | Rejected with an explicit "not supported" error. No authorised transcript API is integrated |
| RAG: FTS5 + vectors + RRF + rerank, budgeting, history, provenance, citation verification, streaming, cancel | done | |
| AI providers: OpenAI-compat, Gemini, Anthropic, Ollama | partial | Tested against a mock server only, never against the live APIs |
| AI assistant actions incl. study guide, flashcards, quiz, compare, translate | done (mock) | Preview-before-apply enforced |
| Audio overviews | done (mock) | Multi-speaker only where the provider supports it; no interactive mode |
| Knowledge graph | done | Force layout; performance with very large graphs not benchmarked |
| Unified search (keyword/full-text/semantic/hybrid) | done | |
| Settings (all §21 sections) | done | Updates section is informational (no updater) |
| Onboarding (7 steps, AI skippable) | done | Two cosmetic issues fixed in this revision |
| i18n English + Turkish | done | |
| Backup/restore, integrity check, corrupt-DB quarantine | done | |
| Keyring secret storage | done | Linux/Windows backends compiled; Windows Credential Manager not verified on a real Windows host in this session |
| Cloud sync | not-started | No sync code; the architecture doc describes the seam |
| Auto-update | not-started | |
| Code signing | blocked | No certificate |
| Performance benchmarks | partial | `npm run bench` covers search, autosave, chunking and embedding (`docs/testing/benchmarks.md`). It led to a vector-cache fix (hybrid search 236 → 37 ms). Packaged-app start-up and rendering are not measured |
| CI (GitHub Actions): Linux tests + E2E, Windows tests + installer + checksums; tag release | done (config) | Workflows were added in this revision. Their first run happens on push, so results are not yet known |
| REA research | partial | REA installed and verified, and used for self-analysis of the bundle. Competitor targets were blocked by the network policy. See `docs/research/` |

## Fixed in the audit round (2026-10-27, second pass)

- Knowledge graph: ResizeObserver callback after unmount threw `Cannot read properties of null (reading 'getBoundingClientRect')`
- Recurring tasks: a yearly task due on Feb 29 skipped to Mar 1; completing a done task again created a duplicate occurrence (both covered by tests)
- Security: exports now go through a Rust-owned save dialog (`export_save`). The renderer can no longer choose an arbitrary file to overwrite. Verified in the desktop app
- UI: the sidebar search placeholder wrapped and was clipped; "1 · Sources" now reads "1 source" (plural support in i18n); source type labels are localised (e.g. "NOTE" → "Not")

## Known defects / risks

1. Generic `db_exec` IPC (the export path issue was fixed by moving to `export_save`). See `docs/security/privacy-security.md`.
2. The URL SSRF guard is hostname-literal only (no DNS rebinding protection).
3. No real-provider AI test has been run.
4. The Windows installer has only been verified in CI, not interactively on a Windows 10/11 desktop.

```json
{
  "version": "0.1.0",
  "updated": "2026-10-27",
  "tests": { "vitest": { "passed": 52, "failed": 0 }, "cargo": { "passed": 10, "failed": 0 }, "playwright": { "passed": 10, "failed": 0 } },
  "acceptance": {
    "1": "PASS_AUTOMATED", "2": "PASS", "3": "PASS", "4": "PASS", "5": "PASS", "6": "PASS", "7": "PASS",
    "8": "PASS", "9": "PASS", "10": "PASS", "11": "PASS", "12": "PASS", "13": "PASS", "14": "PASS_MOCK", "15": "PASS_AUTOMATED"
  },
  "not_started": ["youtube_ingestion", "cloud_sync", "auto_update"],
  "partial": ["pdf_export_direct", "ocr_offline", "live_ai_provider_verification", "benchmarks_desktop", "rea_competitor_research"],
  "blocked": ["code_signing"],
  "manual_pending": ["interactive_install_on_windows_10_11"]
}
```
