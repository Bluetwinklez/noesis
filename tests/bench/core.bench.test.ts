import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryStore } from '../helpers';
import { docFromParagraphs } from '../../src/core/doc';
import { search } from '../../src/search/search';
import { chunkPages } from '../../src/ingestion/chunker';
import { localHashEmbed } from '../../src/search/vectors';

// Repeatable micro-benchmarks for the local data path (node:sqlite, in-memory).
// Run with `npm run bench`; results go to tests/bench/results.json and docs/testing/benchmarks.md.

const WORDS = 'river glacier volcano basalt delta erosion tide moon orbit photosynthesis enzyme membrane chloroplast'.split(' ');
const sentence = (i: number) => Array.from({ length: 14 }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ') + '.';

async function measure(name: string, iterations: number, fn: () => unknown | Promise<unknown>) {
  for (let i = 0; i < Math.min(5, iterations); i++) await fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const pct = (p: number) => +samples[Math.min(samples.length - 1, Math.floor(p * samples.length))].toFixed(3);
  return { name, iterations, median_ms: pct(0.5), p95_ms: pct(0.95), max_ms: +samples[samples.length - 1].toFixed(3) };
}

it('benchmarks the local data path', { timeout: 600_000 }, async () => {
  const store = await memoryStore();
  const ws = (await store.workspaces.create('Bench')).id;
  const ids: string[] = [];
  const seedStart = performance.now();
  for (let i = 0; i < 2000; i++) {
    const p = await store.pages.create({ workspaceId: ws, title: `Page ${i}` });
    await store.pages.saveContent(p.id, docFromParagraphs(Array.from({ length: 10 }, (_, k) => sentence(i + k))));
    ids.push(p.id);
  }
  const seedMs = performance.now() - seedStart;
  const bigDoc = docFromParagraphs(Array.from({ length: 2000 }, (_, k) => sentence(k)));
  const book = Array.from({ length: 300 }, (_, p) => ({ pageNumber: p + 1, text: Array.from({ length: 40 }, (_, k) => sentence(p + k)).join(' ') }));

  const results = [
    await measure('full-text search, 2,000 pages', 50, () => search(store.db, 'glacier basalt', { workspaceId: ws, mode: 'fulltext' })),
    await measure('hybrid search, 2,000 pages (local vectors)', 20, () => search(store.db, 'glacier basalt', { workspaceId: ws, mode: 'hybrid' })),
    await measure('autosave 28k-word page (content + links + index)', 20, () => store.pages.saveContent(ids[0], bigDoc)),
    await measure('chunk 300-page document', 20, () => chunkPages(book)),
    await measure('local-hash-512 embedding, 1 chunk', 200, () => localHashEmbed(sentence(1).repeat(40))),
  ];
  const out = { date: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, seed_2000_pages_ms: Math.round(seedMs), results };
  writeFileSync(join(import.meta.dirname, 'results.json'), JSON.stringify(out, null, 2) + '\n');
  console.table(results);
});
