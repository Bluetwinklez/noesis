# Daily notes and calendar

The Today action is available in the command palette and as `Ctrl+Alt+D`. It uses the computer's local date, creates a Daily notes/Günlük notlar parent when needed, and reopens the existing child for repeated calls on the same day.

Settings → General provides three title styles (ISO, localized short and localized long) plus an optional saved page template. A template is copied only when a daily page is first created. Changing the format does not rename existing notes.

Migration v7 records each workspace/day-to-page mapping independently of the page title. Backups include the mapping, and workspace ZIP transfers map it through exported page paths. A note in trash or archive must be restored before opening that day.

The sidebar calendar respects the existing first-day-of-week setting. An accent dot means a daily note exists; a warning dot means at least one unfinished task is due that day. Clicking any day opens or creates that date's note.

Automated evidence:

- `tests/unit/daily-notes.test.ts` covers local date keys, localized title formats, Monday/Sunday grid alignment, idempotent creation and template copying.
- `tests/e2e/app.spec.ts` covers `Ctrl+Alt+D`, the command-palette action, duplicate prevention, next-month navigation and selecting a date.

The test fixes dates through local `Date` construction; it does not assume UTC. DST changes and every operating-system locale are not exhaustively tested.
