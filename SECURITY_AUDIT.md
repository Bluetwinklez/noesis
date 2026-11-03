# Repository security and maintenance audit

Date: 2026-11-03. Repository: `Bluetwinklez/noesis`.

## Scope and method

Default-branch workflows, React/Tauri architecture and dependency/credential audits. Calendar regression changes and their additional tests are tracked separately in PR #19 against the daily-notes feature branch.

Fetched the repository and scanned all locally fetched Git refs/history with Gitleaks 8.30.1 in fully redacted mode. Reviewed tracked sensitive-file patterns and personal-email candidates. Dependency audits describe the installed/resolved graph on this date; they are not a penetration test or a guarantee that no undiscovered vulnerability exists. Uploaded binaries, remote service configuration and files outside accessible Git refs are outside this scan.

## Changes

Pinned default-branch CI/release action implementations, added verified secret scanning and documented security findings. The calendar correction stays in PR #19; this change does not import the daily-notes feature into main.

All maintained repositories receive an English security policy/audit entry point, a pinned and checksum-verified secret-scan workflow, credential ignore patterns and immutable action references. Existing publishing jobs retain their declared permissions. Known false positives, if any, are exempted only by exact historic finding fingerprints; no entire directory or credential rule is disabled.

## Credential and personal-data findings

No Gitleaks matches were found in fetched Git history.

No working private credential was confirmed in this review. No credential values are included in this report. If a real credential is discovered later, revoke it at its provider; deleting source cannot revoke a key or remove forks, caches or clones. Existing GitHub encrypted secrets were neither read nor copied. No live-account credential testing was attempted.

## Validation

On the related daily-notes branch, 138 unit tests, typecheck, four mock AI evaluation cases, two benchmarks, production build and focused calendar/evidence/performance checks passed. Default-branch source code is unchanged here; its Windows/Linux CI validates the current main revision independently. The initial full run passed 28/30; focused reruns passed, and the final complete run passed all 30 scenarios. Measured seeded browser startup was 1,313.1 ms and the warm 2,000-row table opened in 238.4 ms. npm audit reports zero known vulnerabilities.

GitHub Actions YAML was checked with Actionlint. Local log files are kept outside the repositories; do not confuse historical README test counts with new results.

## Remaining limits

Browser preview tests do not certify Windows IPC, native installers, live providers or packaged startup performance. Local Rust test/Clippy builds are blocked by missing GLib/GTK pkg-config development libraries. Windows-native CI remains the applicable native validation.

Main READMEs and new maintenance documents are English. Historical Turkish records and existing application translations remain; this maintenance does not claim a full UI translation. Changes are published in reviewable branches/PRs, not as an untested release.

## Suggested GitHub About description

A local-first Windows workspace for notes, databases, source-grounded research and optional AI assistance.

The current GitHub integration rejected repository metadata edits with HTTP 403. This prepared description can be applied when repository administration access is available; it has not been represented as an applied settings change.

## Target-specific Rust advisory follow-up

An OSV lockfile query identified `glib 0.18.5` (`RUSTSEC-2024-0429`, alias `GHSA-wrw7-89jp-8q8g`: iterator unsoundness) and `proc-macro-error 1.0.4` (`RUSTSEC-2024-0370`: unmaintained). These are two advisory types, not three independent issues. The latter is an informational maintenance warning.

For this Windows application, `cargo tree --locked --target x86_64-pc-windows-msvc -i glib` and the equivalent `proc-macro-error` query both return no dependency path. The affected crates are in the cross-platform lockfile's GTK/Linux chain, outside the reviewed Windows target. A future Linux product/build must resolve these findings before claiming Linux readiness. Replacing GLib 0.18 with 0.20 by a forced transitive override is not an API-compatible repair for the current GTK/Tauri stack. No advisory rule was globally disabled.

## Import reliability follow-up

The percent-sign import fix from PR #16 was updated against current main. Paths with literal percent signs no longer abort the whole import; valid percent escapes still resolve internal links. Type checking, unit tests, benchmarks and all 29 main-branch browser scenarios passed locally. Windows installer validation runs in CI.
