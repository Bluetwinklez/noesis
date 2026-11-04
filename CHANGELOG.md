# Changelog

## Unreleased

- Add workspace-scoped page tabs, a side-by-side page view and live heading outlines as a panel or insertable table-of-contents block. Open editors and tab preferences participate in the pending-write flush.

- Closing the window now hides Noesis in the system tray instead of quitting, so quick capture (`Ctrl+Shift+Space`), reminders and the MCP endpoint keep running. New desktop setting Settings → General → "Keep running in the tray when closed" (default on, `Prefs.closeToTray`). Pending saves are flushed before the window is hidden. A downloaded update that installs on close still wins over hiding. A left click on the tray icon and a second launch of the app (single-instance handler) now show the hidden window; the tray menu keeps "Quit" for a real exit. A one-time system notification explains that the app was not closed. Decision logic in `src/app/closeBehavior.ts` (unit tests in `tests/unit/close-behavior.test.ts`); the window hide/show itself is verified manually on Windows.

## Repository hardening — 2026-11-03

- Pin CI action implementations and verify the secret-scanner release checksum.
- Document security findings and native-validation limits in `SECURITY_AUDIT.md`.
- Make the daily-calendar regression independent of wall-clock rollover and scope navigation to the calendar region.

## Unreleased

- Ask across workspace pages and sources attached to any notebook, with navigable evidence and unsupported-answer warnings. Answers are session-only; local lexical/hash retrieval and mock tests do not prove factual correctness.

- Add daily notes with a `Ctrl+Alt+D` Today action, configurable localized date titles, optional saved-page templates and a sidebar calendar that marks note days and outstanding task due dates. Daily date identities survive renames, backups and workspace ZIP transfers. Limit sidebar windows to 15 pages and table windows to 50 rows to maintain responsiveness.

- Fix "URI malformed" when importing a Notion/Obsidian/Markdown export: a note whose file name or link contains a literal `%` (for example "Zam 20% oldu.md" or `[x](100%.md)`) made `decodeURIComponent` throw and aborted the whole import. Paths and links are now decoded with `safeDecode`, which only decodes valid `%XX` runs and keeps everything else as written. Regression test in `tests/unit/import.test.ts` failed on the old code.
- Keep large workspaces responsive with progressive 50-page sidebar windows and 100-row table pages. Add a reproducible 5,000-page / 100,000-row / 1,000-source seed and regression benchmark. Workspace CSV imports now batch rows and their search entries, reducing the measured full seed import from about 44 minutes to 11.3 seconds in the final verification run.

- Knowledge graph: optional 3D view (three.js, loaded only when turned on) on a dark star-field. Nodes glow and have a shape per kind (spheres, boxes for repositories, diamonds for agents) with name labels; links are coloured by relationship and curve for agent and repository links. Hovering or selecting dims everything except the node and its neighbours, the camera frames the whole graph, orbits slowly and flies to a selection, and a legend counts each kind. Selecting an AI agent shows its recent activity: what it created, appended, clipped or added, with times. Appends through MCP now refresh open views like other agent writes, so the graph and activity list follow every agent live.

- Remember which AI client (Claude Code, Codex, …) created or changed pages, clips and tasks through MCP, in a new v6 `agent_activity` table. The knowledge graph shows each client as an agent node linked to the pages it wrote, and GitHub repositories mentioned in pages as shared nodes, so notes about the same repository meet. Both are filterable. Agent activity is kept in backups (older backups still restore) and in workspace exports/imports (`Noesis data/agent-activity.json`).

- Add four selectable whole-interface styles: Classic Noesis, Pastel Library, Kawaii Retro and Sherwood. Each style supplies its own shape, typography, surface and scenery treatment while light/dark mode, eight colour palettes and accent colours remain independently adjustable.

- Keep render failures inside app/view error boundaries with reload and diagnostic actions. Add independent startup recovery with validated backup restore, preserved original database copies, raw database export and the desktop automatic-backups folder. Corrupt databases no longer silently open as empty workspaces.

- Recover sources left in processing at startup with a localized retry message, retain their original files/text, and prevent concurrent processing across pipeline instances. Initialize boot only once under React StrictMode.

- Persist unsupported-answer warnings with a new v5 migration, including legacy backups, and preserve chat evidence flags in workspace exports/imports.
- Mark uncited sentences in cited answers, keep citation click-through and Markdown formatting, and clarify that a citation number does not prove a claim.
- Add a separate four-case evidence evaluation harness, deterministic mock CI checks and owner-run live-provider configuration.

- Condense long Studio sources in bounded parts before summaries, study guides, FAQs, timelines, briefings, comparisons, flashcards, quizzes and audio scripts, so the end of a document is considered.
- Share source context fairly, including source wrappers in the character budget; show condensation progress, coverage and warnings for omitted sections or shortened provider output in English and Turkish.
- Preserve Studio notes and coverage in workspace ZIP exports/imports, remap source links on import, and persist generated notes before opening their dialog.

## 0.1.0 — Early preview

### Workspace

- Block editing with Markdown paste, slash commands, math, tables and page mentions.
- Workspaces, nested pages, autosave, history, templates, backlinks and trash.
- Structured database views, recurring tasks, search and a knowledge graph.
- Research notebooks with selected sources, streamed answers, navigable citations and study materials.
- Optional cloud/local AI adapters and audio overviews.

### Reliability

- Closing the window, quitting from the tray and installing an update first finish delayed saves (no lost last edits).
- Consistent database snapshots for backup creation.
- Explicit failure for missing attachments instead of incomplete backups.
- Backup format, schema, table and attachment verification before restore.
- Foreign keys remain enforced throughout restore; constraints defer within its transaction.
- Cancelling the safety backup cancels the restore operation.
- Safer native exports, recurrence fixes and graph lifecycle fixes from the existing development branch.

### Distribution and documentation

- English README with four real sample-workspace screenshots, setup steps and keyboard shortcuts.
- English architecture, privacy, testing, contribution and release documentation.
- Version-validated GitHub release pipeline with web checks, Windows native tests, unsigned NSIS/MSI installers, install/launch/uninstall smoke test and SHA-256 checksums.

This is preview software. Live AI services and every Windows desktop configuration have not been verified. See [release notes](docs/releases/v0.1.0.md) for scope and limitations.
