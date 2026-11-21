import { describe, expect, it } from 'vitest';
import { memoryStore } from '../helpers';
import { docFromParagraphs } from '../../src/core/doc';
import { rebuildSearchIndex, searchIndexMismatch } from '../../src/core/search-rebuild';
import { checkSearchIndexOnStartup, healSearchIndexIfNeeded } from '../../src/app/maintenance';
import { useApp } from '../../src/app/state';
import { search } from '../../src/search/search';

describe('search index rebuild', () => {
  it('restores pages, database rows, tasks, notebooks and source chunks while excluding trashed and archived pages', async () => {
    const s = await memoryStore();
    const ws = (await s.workspaces.create('Research')).id;
    const otherWs = (await s.workspaces.create('Other')).id;

    // Live, trashed and archived pages.
    const livePage = await s.pages.create({
      workspaceId: ws,
      title: 'Alpine flora',
      content: docFromParagraphs(['Edelweiss grows on limestone cliffs.']),
    });
    const trashedPage = await s.pages.create({
      workspaceId: ws,
      title: 'Trashed draft',
      content: docFromParagraphs(['Trashedneedle should stay unindexed.']),
    });
    await s.pages.trash(trashedPage.id);
    const archivedPage = await s.pages.create({
      workspaceId: ws,
      title: 'Archived memo',
      content: docFromParagraphs(['Archivedneedle should stay unindexed.']),
    });
    await s.pages.setArchived(archivedPage.id, true);

    // Live database + row (including status option) and a trashed database + row.
    const dbPage = await s.databases.createDatabase(ws, 'Field specimens');
    const props = await s.databases.properties(dbPage.id);
    const titleProp = props.find((p) => p.type === 'title')!;
    const statusProp = props.find((p) => p.type === 'status')!;
    const locProp = await s.databases.addProperty(dbPage.id, 'Location', 'text');
    const liveRow = await s.databases.addRow(dbPage.id, {
      [titleProp.id]: 'Quartz crystal',
      [locProp.id]: 'Valais valley',
      [statusProp.id]: 'in_progress',
    });

    const trashedDb = await s.databases.createDatabase(ws, 'Discarded table');
    const trashedTitle = (await s.databases.properties(trashedDb.id)).find((p) => p.type === 'title')!;
    await s.databases.addRow(trashedDb.id, { [trashedTitle.id]: 'Ghostrow entry' });
    await s.pages.trash(trashedDb.id);

    // Task, notebook, notebook note, ready source + chunk.
    const task = await s.tasks.create({
      workspaceId: ws,
      title: 'Calibrate altimeter',
      notes: 'Verify barometric pressure sensor before ascent.',
    });
    const notebook = await s.notebooks.create(ws, 'Botany study', 'High altitude plant taxonomy');
    const note = await s.notebooks.addNote(notebook.id, 'summary', 'Treeline summary', 'Conifer treeline observations.');
    const source = await s.sources.create({ workspaceId: ws, title: 'Glacier monograph', kind: 'note', origin: 'pasted' });
    const chunkText = 'Moraine sediments record glacial retreat across the valley.';
    await s.sources.setExtracted(source.id, chunkText, 1, {});
    await s.sources.replaceChunks(
      source.id,
      [{ text: chunkText, pageNumber: 1, charStart: 0, charEnd: chunkText.length, embedding: null }],
      null,
    );
    await s.sources.setStatus(source.id, 'ready', 'done');

    // Another workspace that must not be cleared when rebuilding `ws`.
    const otherPage = await s.pages.create({
      workspaceId: otherWs,
      title: 'Other workspace note',
      content: docFromParagraphs(['Untouched foreign workspace content.']),
    });

    // Simulate external/stale index loss.
    await s.db.run('DELETE FROM search_index WHERE workspace_id = ?', [ws]);
    await s.db.run("INSERT INTO chunks_fts(chunks_fts) VALUES ('delete-all')");

    expect(await search(s.db, 'edelweiss', { workspaceId: ws, mode: 'fulltext' })).toHaveLength(0);
    expect(await search(s.db, 'Valais', { workspaceId: ws, mode: 'fulltext' })).toHaveLength(0);
    expect(await search(s.db, 'altimeter', { workspaceId: ws, mode: 'fulltext' })).toHaveLength(0);
    expect(await search(s.db, 'taxonomy', { workspaceId: ws, mode: 'fulltext' })).toHaveLength(0);
    expect(await search(s.db, 'moraine', { workspaceId: ws, mode: 'fulltext' })).toHaveLength(0);
    expect((await search(s.db, 'Untouched', { workspaceId: otherWs, mode: 'fulltext' })).some((h) => h.refId === otherPage.id)).toBe(true);

    // Rebuild in small batches and verify counts and search results.
    const counts = await rebuildSearchIndex(s.db, ws, { batchSize: 2 });
    expect(counts).toEqual({
      pages: 2, // livePage + dbPage (excludes trashedPage, archivedPage, trashedDb)
      rows: 1, // liveRow (excludes trashedDb's row)
      tasks: 1,
      notebooks: 1,
      notes: 1,
      sources: 1,
      chunks: 1,
    });

    expect((await search(s.db, 'edelweiss', { workspaceId: ws, mode: 'fulltext' })).some((h) => h.kind === 'page' && h.refId === livePage.id)).toBe(true);
    expect((await search(s.db, 'Valais', { workspaceId: ws, mode: 'fulltext' })).some((h) => h.kind === 'row' && h.refId === liveRow.id)).toBe(true);
    expect((await search(s.db, 'progress', { workspaceId: ws, mode: 'fulltext' })).some((h) => h.kind === 'row' && h.refId === liveRow.id)).toBe(true);
    expect((await search(s.db, 'altimeter', { workspaceId: ws, mode: 'fulltext' })).some((h) => h.kind === 'task' && h.refId === task.id)).toBe(true);
    expect((await search(s.db, 'taxonomy', { workspaceId: ws, mode: 'fulltext' })).some((h) => h.kind === 'notebook' && h.refId === notebook.id)).toBe(true);
    expect((await search(s.db, 'Conifer', { workspaceId: ws, mode: 'fulltext' })).some((h) => h.kind === 'note' && h.refId === note.id)).toBe(true);
    expect((await search(s.db, 'monograph', { workspaceId: ws, mode: 'fulltext' })).some((h) => h.kind === 'source' && h.refId === source.id)).toBe(true);
    expect((await search(s.db, 'moraine', { workspaceId: ws, mode: 'fulltext' })).some((h) => h.kind === 'chunk' && h.parentId === source.id)).toBe(true);

    // Trashed/archived pages and trashed database rows stay out.
    expect(await search(s.db, 'Trashedneedle', { workspaceId: ws, mode: 'fulltext' })).toHaveLength(0);
    expect(await search(s.db, 'Archivedneedle', { workspaceId: ws, mode: 'fulltext' })).toHaveLength(0);
    expect(await search(s.db, 'Ghostrow', { workspaceId: ws, mode: 'fulltext' })).toHaveLength(0);

    // Other workspace remained untouched.
    expect((await search(s.db, 'Untouched', { workspaceId: otherWs, mode: 'fulltext' })).some((h) => h.refId === otherPage.id)).toBe(true);
  });

  it('indexes all pages cleanly across multiple transaction batches', async () => {
    const s = await memoryStore();
    const ws = (await s.workspaces.create('Batch')).id;
    const created: Awaited<ReturnType<typeof s.pages.create>>[] = [];
    for (let i = 1; i <= 7; i++) {
      created.push(
        await s.pages.create({
          workspaceId: ws,
          title: `Batch page ${i}`,
          content: docFromParagraphs([`Unique batchtoken${i} content.`]),
        }),
      );
    }

    await s.db.run('DELETE FROM search_index WHERE workspace_id = ?', [ws]);
    const counts = await rebuildSearchIndex(s.db, ws, { batchSize: 2 });
    expect(counts.pages).toBe(7);

    for (let i = 1; i <= 7; i++) {
      const hits = await search(s.db, `batchtoken${i}`, { workspaceId: ws, mode: 'fulltext' });
      expect(hits.some((h) => h.refId === created[i - 1].id)).toBe(true);
    }
  });
});

describe('startup search-index self-healing', () => {
  it('detects missing and stale indexed pages and rebuilds only when counts differ', async () => {
    const s = await memoryStore();
    const ws = (await s.workspaces.create('Heal')).id;
    const p1 = await s.pages.create({ workspaceId: ws, title: 'First page', content: docFromParagraphs(['Alphaneedle']) });
    await s.pages.create({ workspaceId: ws, title: 'Second page', content: docFromParagraphs(['Betaneedle']) });
    const trashed = await s.pages.create({ workspaceId: ws, title: 'Gone page' });
    await s.pages.trash(trashed.id);
    const archived = await s.pages.create({ workspaceId: ws, title: 'Old page' });
    await s.pages.setArchived(archived.id, true);

    // Already in sync: no rebuild performed.
    expect(await searchIndexMismatch(s.db, ws)).toEqual({ livePages: 2, indexedPages: 2, mismatch: false });
    expect(await healSearchIndexIfNeeded(s.db, ws)).toBeNull();

    // Missing row in search_index triggers a rebuild.
    await s.db.run("DELETE FROM search_index WHERE kind = 'page' AND ref_id = ?", [p1.id]);
    expect(await searchIndexMismatch(s.db, ws)).toEqual({ livePages: 2, indexedPages: 1, mismatch: true });
    const healedMissing = await healSearchIndexIfNeeded(s.db, ws);
    expect(healedMissing?.pages).toBe(2);
    expect(await searchIndexMismatch(s.db, ws)).toEqual({ livePages: 2, indexedPages: 2, mismatch: false });
    expect((await search(s.db, 'Alphaneedle', { workspaceId: ws, mode: 'fulltext' })).some((h) => h.refId === p1.id)).toBe(true);

    // Extra orphan row in search_index also triggers a rebuild and is cleaned up.
    await s.db.run(
      "INSERT INTO search_index(kind, ref_id, workspace_id, parent_id, title, body) VALUES ('page','orphan-id',?,'','Orphan','stale')",
      [ws],
    );
    expect(await searchIndexMismatch(s.db, ws)).toEqual({ livePages: 2, indexedPages: 3, mismatch: true });
    const healedOrphan = await healSearchIndexIfNeeded(s.db, ws);
    expect(healedOrphan?.pages).toBe(2);
    expect(await searchIndexMismatch(s.db, ws)).toEqual({ livePages: 2, indexedPages: 2, mismatch: false });
  });

  it('runs the startup check at most once per launch and shows a toast when repaired', async () => {
    const s = await memoryStore();
    const ws = (await s.workspaces.create('Startup')).id;
    await s.pages.create({ workspaceId: ws, title: 'Boot note', content: docFromParagraphs(['Startupneedle']) });
    await s.db.run('DELETE FROM search_index WHERE workspace_id = ?', [ws]);

    useApp.setState({ repos: s, workspaceId: ws, lang: 'en', toasts: [] });
    try {
      const first = await checkSearchIndexOnStartup();
      expect(first?.pages).toBe(1);
      expect(useApp.getState().toasts.some((toast) => toast.message === 'Search index repaired (1 page).')).toBe(true);

      // Even if the index diverges again later in the same launch, the startup check does not re-run.
      await s.db.run('DELETE FROM search_index WHERE workspace_id = ?', [ws]);
      const second = await checkSearchIndexOnStartup();
      expect(second).toBeNull();
    } finally {
      for (const toast of useApp.getState().toasts) useApp.getState().dismissToast(toast.id);
      useApp.setState({ repos: null, workspaceId: null, toasts: [] });
    }
  });
});
