# Changelog

## Unreleased

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
