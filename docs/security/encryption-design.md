# Optional encryption at rest — design for review

Status: **proposal only; owner approval required before implementation**. Default remains off. This document does not claim encryption is implemented or verified.

## Scope and threat model

When enabled, protect the SQLite database, its journals and WAL, attachment contents, and newly created automatic and manual backups from an attacker who obtains a powered-off device or copies those files without the password. Keep the application usable offline. Do not claim protection against malware, a compromised unlocked user session, memory inspection, screen capture, a malicious AI provider, operating-system paging/hibernation, filenames or file sizes, existing exports, old plaintext backups, filesystem snapshots or cloud copies. Windows full-disk encryption remains complementary.

Current state: `src-tauri/src/db.rs` opens bundled SQLite and enables WAL; the renderer has an authorized SQL bridge. Attachments are separate files. `src/core/backup.ts` currently creates an unencrypted ZIP containing structured records and attachment bytes. Startup recovery opens and checks an independent SQLite staging database. These paths all need coordinated changes, not just a database pragma.

## Proposed design

1. Use a single audited SQLCipher build in the native Rust layer, replacing the bundled SQLite linkage consistently across all native connections, FTS5, recovery and CI. Check the applicable SQLCipher edition, licence, build reproducibility, platform support and SQLite compatibility before choosing dependencies. Browser preview remains an explicitly unencrypted development mode; do not label it protected.
2. At first enablement, generate a random data-encryption key (DEK). Derive a key-encryption key from the user password with a vetted, versioned memory-hard password KDF (proposed Argon2id; benchmark and record parameters on supported Windows machines). Wrap the DEK with an authenticated encryption scheme and a random salt/nonce, stored in a versioned envelope. Changing a password rewraps the DEK only after verifying the old password. Do not embed keys in the application, database, backups, logs, command lines, SQL text or web storage. Keep plaintext key material in native memory for the shortest practical lifetime, zeroize where supported, and do not promise guaranteed erasure from OS memory.
3. Supply the SQLCipher key through a native API before any database reads, configuration, migrations or integrity checks. Only then install the SQL authorizer. Block renderer-issued key/rekey/cipher and filesystem escape pragmas; never expose the DEK or password through generic SQL. Define a narrowly scoped unlock IPC with no logging and minimize plaintext transit; verify that Tauri IPC does not persist secrets. A native password dialog is preferred if feasible. Locked state disables database commands, MCP, background services and auto-update installation until unlock or explicit safe shutdown.
4. Encrypt each attachment with a unique nonce and authenticated encryption under a domain-separated key derived from the DEK, with a versioned envelope and authenticated metadata. Stream large files with bounded memory and atomic writes; reject altered/truncated files. Attachment filenames, sizes, timestamps, thumbnails, OCR intermediates, crash logs and temporary files require explicit inventory and leakage tests. No plaintext temporary attachment on disk unless the user explicitly exports one.
5. Use a versioned authenticated encrypted backup envelope containing the existing validated snapshot and all attachments. Derive a separate backup key from a backup password and independent salt; authenticate format/version and metadata. Require a password when restoring, including independent startup recovery. Never silently downgrade to a plaintext backup. Existing plaintext backups and ZIP exports remain readable only via explicit warning and consent; the latter are deliberately plaintext unless separately encrypted.

## Enablement, migration and failure recovery

1. Explain the password-loss consequence clearly: **if the password and any separately protected recovery key are lost, encrypted data cannot be recovered**. Require confirmation and a tested, user-controlled backup before migration. Do not rely on Windows Credential Manager as the only copy; optional convenience unlock would be a separate opt-in with its own threat model.
2. Flush all registered writes, stop MCP and ingestion, acquire an exclusive migration lock, checkpoint safely and account for DB/WAL/SHM. Check free disk space. Do not mutate the only copy of the original.
3. Create encrypted database and attachment staging locations on the same volume using restrictive permissions. Use a trusted native migration path, not the renderer's SQL bridge. SQLCipher documents `sqlcipher_export()` for copying an existing plaintext database; it must be validated with the exact chosen SQLCipher build, schema, FTS, indexes, user version and key-handling approach. SQLite WAL is persistent database state and must be included in a consistent snapshot. [SQLCipher migration](https://www.zetetic.net/sqlcipher/encrypting-plaintext-databases/), [SQLite WAL](https://www.sqlite.org/wal.html).
4. Verify source and destination counts, foreign keys, FTS behavior, attachment authentication and database integrity. Close and reopen the encrypted staging copy using the supplied password, then atomically install with a journaled state machine and preserve the original until successful post-restart verification. Every interrupted step must resume or roll back without silently opening an empty database.
5. Ask the user what to do with the preserved plaintext original and old backups only after verification; deletion is not guaranteed secure on SSDs, snapshots or cloud drives. No destructive cleanup without an explicit targeted action. Disabling encryption requires the inverse staged, verified process and an explicit warning that new files will be plaintext.

## UX and recovery

- Settings → Security: off/on, password setup with confirmation, strength guidance, change password, lock and documented disable flow. Both English and Turkish text. No password hints or recovery secrets in logs.
- Unlock screen precedes repository initialization; wrong password, corrupt database and unsupported version are distinguishable only where doing so does not leak secrets or destroy evidence. Retry is bounded against accidental repeated attempts without claiming protection from an offline brute-force attacker.
- Recovery screen works while the main DB is closed: unlock an encrypted backup and restore through independently validated staging, export the raw encrypted DB with WAL where necessary, open backup folder and copy redacted diagnostics. It must never export decrypted raw DB without a clearly labelled user action.
- Show a clear state when the password is forgotten: there is no backdoor. Existing backups may have different passwords. User owns all recovery keys and decisions.

## Required verification before release

- Unit and integration: correct/wrong password, KDF and envelope versioning, tamper/truncation rejection, password change, attachment encryption and key separation, v1–v7 migrations, encrypted backups and legacy plaintext restore, no plaintext credentials in logs/SQL or IPC errors.
- Crash/fault injection at every migration, rekey, restore and file replacement phase; include WAL/SHM, no disk space, permission denial, interrupted writes, corrupted backup and rollback. Assert originals remain recoverable.
- Automated browser UI for settings and locked state using an explicitly labelled test implementation; native Windows tests for the actual SQLCipher build, FTS, attachments, backup/recovery and lock lifecycle. Inspect DB/WAL/temp/attachments and backup bytes for seeded plaintext; document limitations of such scans.
- Measure unlock latency, memory and encrypted write/search/backup overhead against current large-data benchmarks. Test signed upgrade/downgrade compatibility and independent security review before any release.

## Decisions required before implementation

Owner approval of this threat model, password/recovery experience, SQLCipher edition/licensing, backup password policy and plaintext migration retention. Confirm whether attachments are in scope: without them, the UI must say **database-only encryption**, not that all user data is encrypted. The design recommends including them before calling the feature complete.
