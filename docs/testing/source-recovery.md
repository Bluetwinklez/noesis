# Interrupted source processing

At boot, `src/app/recover-sources.ts` atomically changes all `processing` sources to `error` with a stable `processing_interrupted` error code, then flushes persistence. The source list, preview and notebook source list translate this code into English or Turkish. Existing stage, attachments, text and chunks remain available. Pending, ready and previously failed sources are not changed.

The user chooses **Source actions → Reprocess** to retry from the retained original file, URL or pasted text. Startup never launches OCR, network downloads or paid provider requests automatically. Missing original files still produce the existing recoverable validation error on retry. A failed recovery write prevents normal boot rather than silently presenting unrecovered state.

Pipeline instances sharing the application source repository use one reservation map. Reservations are taken synchronously before the first await and released in finally on completion, cancellation or failure. The desktop application already uses a single-instance guard; this is not a multi-process database lease. Boot itself is also shared across StrictMode effect invocations.

Verification:

- `npx vitest run tests/unit/source-recovery.test.ts`: interrupted sources in two workspaces, unchanged ready/error records, retained file and pasted text, idempotent recovery, successful retries, and two concurrent pipeline instances. The original implementation failed the recovery and concurrency assertions.
- `npx playwright test -g 'startup flags interrupted'`: import the real PDF fixture, persist an extraction-stage processing record, reload, observe the retry warning, use the existing reprocess menu, and verify recovered PDF text. This simulates persisted interrupted state, not killing a native Windows OCR process.

No new data fields are introduced; existing backup and ZIP behavior remains applicable. Real Windows termination during OCR is still a manual verification task.
