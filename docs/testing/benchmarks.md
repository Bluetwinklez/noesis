# Benchmarks

`npm run bench` runs `tests/bench/core.bench.test.ts` and writes `tests/bench/results.json`. It uses the same repository code as the app on `node:sqlite` (in memory) with 2,000 seeded pages of about 140 words each. The numbers are medians and p95 over repeated runs after warm-up. They are **measurements on one machine, not targets**.

Machine: Linux x64 container, 4 vCPU, Node 22.22.0 · 2026-10-27

| Operation | Median | p95 |
|---|---|---|
| Seed 2,000 pages (create + autosave each) | 2.6 s total | — |
| Full-text search across 2,000 pages | 4.6 ms | 5.1 ms |
| Hybrid search (FTS + local vectors + RRF), before vector cache | 236 ms | 271 ms |
| Hybrid search, **after** content-keyed vector cache | 36.7 ms | 48.1 ms |
| Autosave a 28k-word page (content, links, search index, snapshot check) | 7.5 ms | 12.4 ms |
| Chunk a 300-page document | 4.2 ms | 4.9 ms |
| `local-hash-512` embedding of one ~550-word chunk | 0.49 ms | 0.60 ms |

Build size (`npm run build`): the startup JS chunk went from 1,434 kB to 429 kB (gzip 446 → 134 kB) after lazy-loading the editor and onboarding.

Not measured: cold start time of the packaged Windows app, WebView rendering of very large documents, and graph rendering with thousands of nodes.
