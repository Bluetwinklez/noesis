# Error and startup recovery

`ErrorBoundary` wraps the application and each route subtree. A render failure displays its message, Reload view and Copy details. Reload remounts only that subtree; navigating to another route resets its boundary. The sidebar and other shell elements remain outside view boundaries. The app boundary also covers onboarding and shell failures. Async event/request failures still use their existing explicit error handling; React boundaries catch render/lifecycle errors.

Boot errors display `RecoveryScreen` directly, without requiring repositories, routing, dialogs or Settings. Its language picker is independent of persisted settings. Available actions:

- Restore backup: validates the archive, builds it in isolated SQLite WASM memory, restores attachments under new keys, checks integrity/foreign keys, then installs the resulting SQLite file and reloads. No access to the failed database is required.
- Export raw database: exports a ZIP containing stored database bytes and any native WAL/SHM files. It is a forensic recovery copy, not a `.noesisbak` backup. Attachments remain in app storage.
- Open automatic backups folder (desktop): Rust opens the fixed app-data backups folder, creating it if necessary. No renderer-selected path is accepted.
- Copy diagnostics: version, error/stack and available storage paths/sizes; never automatically sends diagnostics elsewhere. Text remains selectable if clipboard permission is unavailable.

Native initialization manages optional database state so a database-open failure can reach the WebView. A corrupt file stays in place across repeated launches instead of silently becoming a new workspace. The restore command accepts `packBinary` bytes and uses app-owned paths. Candidate SQLite header and quick-check validation precede closing the old connection; original DB/WAL/SHM files move to unique `noesis.pre-recovery-<uuid>.*` names before replacement. On an install error it attempts to restore these files; failed candidate sidecars stay separate. This is rollback protection for reported I/O errors, not a power-loss-proof multi-file transaction. Recovery copies are retained for manual cleanup.

Browser storage replacement atomically keeps the previous snapshot under `<database-key>.pre-recovery-<uuid>` and writes the new snapshot. Storage read and integrity failures surface to recovery. Browser test databases use isolated keys and do not touch the installed Noesis application or its documents.

Verification:

- Boundary unit test throws a synthetic render error, checks sibling navigation, diagnostic copying and retry. It failed before the boundary was implemented.
- Recovery unit tests reject invalid archives before staging/writes, reconstruct the backup in a separate database, and close staging on success/failure.
- Playwright injects invalid in-memory notebook data, observes the view boundary, navigates through the sidebar, then retries after removing the injected failure. No fault-injection hooks ship in application code.
- Playwright corrupts only its isolated IndexedDB snapshot, rejects an invalid backup, exports and checks exact corrupted bytes, restores a real backup, checks recovered page text and confirms the prior snapshot was preserved.
- Rust tests restore without a database connection, preserve original bytes, reject invalid/corrupt candidates without replacing existing content, and keep corrupt bytes across repeated launches.

Limits: the automated browser test does not drive the native WebView/IPC recovery UI. Real Windows recovery, disk-full/permission errors, power interruption during rename, and very large backups remain manual checks. Staging currently holds SQLite/backup data in memory; failed attempts can leave orphan attachment blobs, and retained recovery copies consume disk space. No schema changes are introduced.
