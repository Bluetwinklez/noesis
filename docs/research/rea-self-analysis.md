# REA self-analysis of the Noesis bundle

| Field | Value |
|---|---|
| Feature | Shipped front-end bundle: module structure and IPC/Electron surface |
| Research question | What does a static reverse-engineering pass see in our own production build, and does it reveal anything to fix? |
| Permitted target | `dist/` built from this repository (our own code) |
| REA tool | `rea analyze-javascript-application` (rea-agents 6.8.0, Node 24.22.1) |
| Confidence | `derived` (REA's own label); partial coverage, see below |

## Run 1: before the change

```
rea analyze-javascript-application <repo>/dist --format json
```

- Outcome: `provider_timeout` after the default 300,000 ms. REA returned **partial Evidence** (`ev_9bea4059…`, root artifact `5a0c8bd3…`).
- Inventory: 31 relevant files, 18 JS files parsed, 12 skipped, 151,345 AST nodes, 721 findings, 0 parse failures.
- The source that timed out was `assets/index-_TPYeafd.js`, the **1.43 MB startup chunk**.
- Electron/IPC summary: 0 browser windows, preload scripts, context bridges or IPC channels. This is expected, because Noesis is a Tauri app and its IPC goes through `@tauri-apps/api`, not Electron. REA's limitations note that "absence" in a partial graph is not proof.
- Condensed evidence: [`evidence/rea-self-analysis-v0.1.0.json`](evidence/rea-self-analysis-v0.1.0.json). The raw 94 MB output was not committed.

## What we changed because of it

The timeout occurred on the oversized startup chunk. Independent of REA, that chunk delays every app start, so it was worth splitting. `PageView` (the Tiptap/ProseMirror editor) and the onboarding flow were imported eagerly in `src/app/App.tsx`, so they are now `React.lazy` imports:

| | Before | After |
|---|---|---|
| Startup chunk (`index-*.js`) | 1,433.66 kB (gzip 446 kB) | 429.19 kB (gzip 134 kB) |
| Editor chunk | (inside startup) | `PageView-*.js` 384.58 kB, loaded on first page open |

All 10 E2E scenarios still pass after the change, including the offline scenario, which preloads lazily split screens.

## Run 2: after the change

`rea analyze-javascript-application <repo>/dist --analysis-timeout-ms 1200000`. The result is recorded below when available.

- Outcome: **still `provider_timeout`**, this time after 1,200,000 ms, again on the startup chunk (`index-DX_HsGqV.js`, now 429 kB). Partial Evidence `ev_2d485104…`, root artifact `82f41661…`.
- Coverage improved: 44 files, **24 parsed** (was 18), 288,871 AST nodes (was 151,345), 1,189 findings, 0 parse failures. Four vendor chunks (`dist-*`, `dist-js-*`) hit REA's result-size budget; REA kept their static and module facts.
- **Correction to run 1's interpretation:** chunk size was not the only cause of the timeout. REA's semantic graph analysis of the minified React/Tiptap code is costly even at 429 kB. The bundle split remains justified by startup cost, not by REA alone.
- For a complete REA pass, analyse with source maps (`build.sourcemap: true`) or analyse `src/` directly. Neither was done here.

## Reproduce

```bash
npm run build
npx -y rea-agents@6.8.0 analyze-javascript-application "$PWD/dist" --format json > rea.json   # needs Node >= 22.23.4
# Website targets (when network policy allows): start Chromium with --remote-debugging-port=9222, open the page, then
rea list-browser-targets http://127.0.0.1:9222
rea inspect-web-page http://127.0.0.1:9222 <targetId> --include-accessibility-text --format json
```
