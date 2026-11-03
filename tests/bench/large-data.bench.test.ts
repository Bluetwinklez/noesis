import { afterAll, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeDriver } from '../../src/core/db/node-driver';
import { openStore } from '../../src/core/store';
import { recoverInterruptedSources } from '../../src/app/recover-sources';
import { search } from '../../src/search/search';
import { applyView } from '../../src/core/repos/databases';
import { pageWindow } from '../../src/lib/pagination';
import { exportWorkspace } from '../../src/export/exporter';
import { importWorkspace } from '../../src/import/importer';
import { memoryBlobs, memoryStore } from '../helpers';
import { LARGE_DATA_COUNTS, LARGE_WORKSPACE_ID, seedLargeData } from '../../scripts/seed-large-data.mjs';

const temporary = mkdtempSync(join(tmpdir(), 'noesis-large-bench-'));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

function stats(samples: number[]) {
  samples.sort((a, b) => a - b);
  const value = (fraction: number) => +samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))].toFixed(3);
  return { median_ms: value(0.5), p95_ms: value(0.95), max_ms: +samples.at(-1)!.toFixed(3) };
}

it('guards the 5k-page / 100k-row / 1k-source path', { timeout: 600_000 }, async () => {
  const file = join(temporary, 'large.db');
  const raw = new DatabaseSync(file);
  const seedStarted = performance.now();
  const counts = seedLargeData(raw);
  const seedMs = performance.now() - seedStarted;
  raw.close();

  const startupStarted = performance.now();
  const repos = await openStore(new NodeDriver(file));
  await recoverInterruptedSources(repos);
  await Promise.all([repos.settings.get('prefs', {}), repos.settings.get('workspaceId', null), repos.workspaces.list()]);
  const startupMs = performance.now() - startupStarted;

  const sidebarStarted = performance.now();
  const pages = await repos.pages.listTree(LARGE_WORKSPACE_ID);
  const sidebarDataMs = performance.now() - sidebarStarted;
  expect(pages).toHaveLength(LARGE_DATA_COUNTS.pages);

  const searchSamples: number[] = [];
  for (let i = 0; i < 25; i++) {
    const started = performance.now();
    await search(repos.db, 'glacier basalt retrieval', { workspaceId: LARGE_WORKSPACE_ID, mode: 'fulltext', limit: 50 });
    if (i >= 5) searchSamples.push(performance.now() - started);
  }

  const tableStarted = performance.now();
  const [properties, rows, views] = await Promise.all([
    repos.databases.properties('large-db-0'),
    repos.databases.rows('large-db-0'),
    repos.databases.views('large-db-0'),
  ]);
  const filtered = applyView(rows, properties, views[0].config);
  const rendered = pageWindow(filtered, 0, 100);
  const tableOpenMs = performance.now() - tableStarted;
  expect(rows).toHaveLength(LARGE_DATA_COUNTS.rowsPerDatabase);
  expect(rendered.items).toHaveLength(100);

  const blobs = memoryBlobs();
  const exportStarted = performance.now();
  const exported = await exportWorkspace(repos, LARGE_WORKSPACE_ID, blobs);
  const exportMs = performance.now() - exportStarted;
  const destination = await memoryStore();
  const importedWorkspace = await destination.workspaces.create('Large import');
  const importStarted = performance.now();
  const imported = await importWorkspace(destination, importedWorkspace.id, [{ path: 'large.noesis.zip', bytes: exported.bytes }], {
    blobs: memoryBlobs(),
    rootTitle: () => 'Imported large dataset',
  });
  const importMs = performance.now() - importStarted;

  const searchLatency = stats(searchSamples);
  const result = {
    date: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    counts,
    seed_ms: +seedMs.toFixed(3),
    startup_ms: +startupMs.toFixed(3),
    sidebar_data_ms: +sidebarDataMs.toFixed(3),
    search: searchLatency,
    table_open_ms: +tableOpenMs.toFixed(3),
    table_rendered_rows: rendered.items.length,
    export_ms: +exportMs.toFixed(3),
    export_bytes: exported.bytes.byteLength,
    import_ms: +importMs.toFixed(3),
    imported: { pages: imported.pages, databases: imported.databases, sources: imported.sources.length },
  };
  writeFileSync(join(import.meta.dirname, 'large-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.table(result);

  expect(startupMs, 'startup should stay under two seconds').toBeLessThan(2_000);
  expect(searchLatency.p95_ms, 'full-text search p95 should stay under 200ms').toBeLessThan(200);
  expect(tableOpenMs, 'opening and preparing a 2,000-row table should stay under 500ms').toBeLessThan(500);

  await repos.db.driver.close?.();
  await destination.db.driver.close?.();
});
