# Contributing to Noesis

Thank you for helping improve Noesis. Prefer a small, complete improvement with a reproducible test over a broad change that is difficult to verify.

## Before you start

- Search existing issues and pull requests; open an issue for substantial feature changes.
- Read the [architecture](docs/architecture/README.md), [security notes](docs/security/privacy-security.md) and [implementation status](docs/implementation-status.md).
- Install Node.js 24, Rust stable and the Tauri platform prerequisites, then run `npm ci`.
- Use a separate sample workspace for testing. Back up important data first.

## Development and checks

```bash
npm run dev
npm run typecheck
npm test
npm run e2e
npm run build
```

For native changes, also run `cargo test --locked` in `src-tauri` after building the frontend. Browser tests do not establish native IPC or Windows installation behavior.

Use English for repository documentation, comments and identifiers. User-facing strings belong in both `src/i18n/en.ts` and `src/i18n/tr.ts`. Preserve existing workspace formats or add a tested schema migration. Never log API keys, credentials or private source contents.

## Pull requests

Explain the user-visible problem, the resulting behavior, and how it was verified. Include screenshots for interface changes, using sample data. Describe genuine limitations; distinguish mock-provider results from live API tests. Add regression tests for data loss, security and persistence fixes.

## Screenshots

Run `npm run screenshots` to capture the English sample workspace into `docs/images/`. Use only sample data. These images are browser-preview captures, not proof of Windows installer behavior.

## Reporting issues

Include your app version, operating system, reproduction steps, expected behavior and redacted error messages. Do not upload API keys, backups, personal source files or account tokens.
