// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { docFromParagraphs } from '../../src/core/doc';
import { handleMcp, type McpContext } from '../../src/mcp/server';
import { memoryStore } from '../helpers';

let s: Repos;
let ctx: McpContext;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
  const r = res!.result as { content: { text: string }[]; isError?: boolean };
  return { isError: !!r.isError, text: r.content[0].text, json: () => JSON.parse(r.content[0].text) };
};

async function createReadySourceWithChunk(workspaceId: string, title: string, chunkText: string, updatedAt: number) {
  const src = await s.sources.create({ workspaceId, title, kind: 'note', origin: 'pasted' });
  await s.sources.setExtracted(src.id, chunkText, 1, {});
  await s.sources.replaceChunks(
    src.id,
    [{ text: chunkText, pageNumber: 1, charStart: 0, charEnd: chunkText.length, embedding: null }],
    null,
  );
  await s.sources.setStatus(src.id, 'ready', 'done');
  await s.db.run('UPDATE sources SET updated_at = ? WHERE id = ?', [updatedAt, src.id]);
  return src;
}

beforeEach(async () => {
  s = await memoryStore();
  const ws = (await s.workspaces.create('MCP Search')).id;
  ctx = {
    repos: s,
    workspaceId: ws,
    client: 'Test Client',
    approve: async () => true,
    notify: () => {},
  };
});

describe('MCP search filters, recent pages and page outline tree', () => {
  describe('search_notes filters and sorting', () => {
    it('filters by parent_id subtree recursively and excludes outside, trashed and foreign pages', async () => {
      const rootA = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Project Atlas' });
      await s.pages.saveContent(rootA.id, docFromParagraphs(['Atlas aurora overview at root']));
      const childA = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: rootA.id, title: 'Field Notes' });
      await s.pages.saveContent(childA.id, docFromParagraphs(['Aurora observations from camp']));
      const grandA = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: childA.id, title: 'Spectra Log' });
      await s.pages.saveContent(grandA.id, docFromParagraphs(['Deep aurora spectrum lines']));
      const trashedChild = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: rootA.id, title: 'Discarded Aurora' });
      await s.pages.saveContent(trashedChild.id, docFromParagraphs(['Aurora note in trash']));
      await s.pages.trash(trashedChild.id);

      const archivedChild = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: rootA.id, title: 'Archived Aurora' });
      await s.pages.saveContent(archivedChild.id, docFromParagraphs(['Archived aurora entry']));
      await s.pages.setArchived(archivedChild.id, true);

      const rootB = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Other Project' });
      await s.pages.saveContent(rootB.id, docFromParagraphs(['Aurora mentioned outside subtree']));

      // Task with the same word must not appear when parent_id scopes to pages.
      await s.tasks.create({ workspaceId: ctx.workspaceId, title: 'Aurora calibration task' });

      // Foreign workspace subtree must never be reachable.
      const otherWs = (await s.workspaces.create('Other')).id;
      const foreignRoot = await s.pages.create({ workspaceId: otherWs, title: 'Foreign Root' });
      await s.pages.saveContent(foreignRoot.id, docFromParagraphs(['Aurora secret foreign note']));

      const inRootA = (await call('search_notes', { query: 'aurora', parent_id: rootA.id })).json() as { id: string; kind: string }[];
      expect(inRootA.every((h) => h.kind === 'page')).toBe(true);
      expect(inRootA.map((h) => h.id).sort()).toEqual([rootA.id, childA.id, grandA.id].sort());

      // Scoping to childA excludes rootA and rootB.
      const inChildA = (await call('search_notes', { query: 'aurora', parent_id: childA.id })).json() as { id: string }[];
      expect(inChildA.map((h) => h.id).sort()).toEqual([childA.id, grandA.id].sort());

      // Foreign, trashed and unknown parent_id return tool errors.
      expect((await call('search_notes', { query: 'aurora', parent_id: foreignRoot.id })).isError).toBe(true);
      expect((await call('search_notes', { query: 'aurora', parent_id: trashedChild.id })).isError).toBe(true);
      expect((await call('search_notes', { query: 'aurora', parent_id: 'missing-id' })).isError).toBe(true);
    });

    it('filters by each supported kind independently and does not starve when many pages match', async () => {
      const page = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Quasar Page' });
      await s.pages.saveContent(page.id, docFromParagraphs(['Quasar telemetry data in page']));

      const dbPage = await s.databases.createDatabase(ctx.workspaceId, 'Catalog');
      const titleProp = (await s.databases.properties(dbPage.id)).find((p) => p.type === 'title')!;
      const row = await s.databases.addRow(dbPage.id, { [titleProp.id]: 'Quasar Row Entry' });

      const task = await s.tasks.create({ workspaceId: ctx.workspaceId, title: 'Check quasar dish', notes: 'Quasar alignment' });
      const nb = await s.notebooks.create(ctx.workspaceId, 'Quasar Research', 'Notebook on quasar redshift');
      const src = await createReadySourceWithChunk(ctx.workspaceId, 'Quasar Paper', 'High-redshift quasar emission bands', Date.now());

      // Add extra pages so non-page kinds would be crowded out without kind pushdown.
      for (let i = 0; i < 25; i++) {
        const extra = await s.pages.create({ workspaceId: ctx.workspaceId, title: `Quasar Log ${i}` });
        await s.pages.saveContent(extra.id, docFromParagraphs(['Quasar quasar repeated log entry']));
      }

      const byPage = (await call('search_notes', { query: 'quasar', kind: 'page', limit: 50 })).json() as { id: string; kind: string }[];
      expect(byPage.length).toBeGreaterThan(0);
      expect(byPage.every((h) => h.kind === 'page')).toBe(true);
      expect(byPage.some((h) => h.id === page.id)).toBe(true);

      const byRow = (await call('search_notes', { query: 'quasar', kind: 'row' })).json() as { id: string; kind: string }[];
      expect(byRow).toHaveLength(1);
      expect(byRow[0]).toMatchObject({ kind: 'row', id: row.id });

      const byTask = (await call('search_notes', { query: 'quasar', kind: 'task' })).json() as { id: string; kind: string }[];
      expect(byTask).toHaveLength(1);
      expect(byTask[0]).toMatchObject({ kind: 'task', id: task.id });

      const byNotebook = (await call('search_notes', { query: 'quasar', kind: 'notebook' })).json() as { id: string; kind: string }[];
      expect(byNotebook).toHaveLength(1);
      expect(byNotebook[0]).toMatchObject({ kind: 'notebook', id: nb.id });

      const byChunk = (await call('search_notes', { query: 'quasar', kind: 'chunk' })).json() as { id: string; kind: string }[];
      expect(byChunk).toHaveLength(1);
      expect(byChunk[0]).toMatchObject({ kind: 'chunk', id: src.id });

      // Invalid kind fails cleanly.
      expect((await call('search_notes', { query: 'quasar', kind: 'unknown' })).isError).toBe(true);
    });

    it('filters by updated_since across pages, rows, tasks, notebooks and chunks', async () => {
      const tOld = Date.parse('2026-01-10T10:00:00.000Z');
      const tCut = Date.parse('2026-06-01T00:00:00.000Z');
      const tNew = Date.parse('2026-09-15T12:00:00.000Z');

      const oldPage = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Old Glacier' });
      await s.pages.saveContent(oldPage.id, docFromParagraphs(['Glacier moraine baseline']));
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [tOld, oldPage.id]);

      const boundaryPage = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Boundary Glacier' });
      await s.pages.saveContent(boundaryPage.id, docFromParagraphs(['Glacier exact cutoff note']));
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [tCut, boundaryPage.id]);

      const dbPage = await s.databases.createDatabase(ctx.workspaceId, 'Expeditions');
      const titleProp = (await s.databases.properties(dbPage.id)).find((p) => p.type === 'title')!;
      const oldRow = await s.databases.addRow(dbPage.id, { [titleProp.id]: 'Old glacier survey' });
      const newRow = await s.databases.addRow(dbPage.id, { [titleProp.id]: 'New glacier survey' });
      await s.db.run('UPDATE db_rows SET updated_at = ? WHERE id = ?', [tOld, oldRow.id]);
      await s.db.run('UPDATE db_rows SET updated_at = ? WHERE id = ?', [tNew, newRow.id]);

      const oldTask = await s.tasks.create({ workspaceId: ctx.workspaceId, title: 'Old glacier sample' });
      const newTask = await s.tasks.create({ workspaceId: ctx.workspaceId, title: 'New glacier sample' });
      await s.db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', [tOld, oldTask.id]);
      await s.db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', [tNew, newTask.id]);

      const newChunkSrc = await createReadySourceWithChunk(ctx.workspaceId, 'Glacier Report', 'Glacier core data', tNew);
      const oldChunkSrc = await createReadySourceWithChunk(ctx.workspaceId, 'Archive Glacier', 'Glacier archive data', tOld);

      const hits = (await call('search_notes', { query: 'glacier', updated_since: '2026-06-01T00:00:00.000Z', limit: 20 })).json() as {
        id: string;
        kind: string;
      }[];
      const ids = hits.map((h) => h.id);
      expect(ids).toContain(boundaryPage.id);
      expect(ids).toContain(newRow.id);
      expect(ids).toContain(newTask.id);
      expect(ids).toContain(newChunkSrc.id);
      expect(ids).not.toContain(oldPage.id);
      expect(ids).not.toContain(oldRow.id);
      expect(ids).not.toContain(oldTask.id);
      expect(ids).not.toContain(oldChunkSrc.id);

      // Date-only ISO string also works.
      const dateOnly = (await call('search_notes', { query: 'glacier', updated_since: '2026-09-01' })).json() as { id: string }[];
      expect(dateOnly.map((h) => h.id)).not.toContain(boundaryPage.id);
      expect(dateOnly.map((h) => h.id)).toContain(newTask.id);

      // Invalid timestamps return a tool error.
      expect((await call('search_notes', { query: 'glacier', updated_since: 'yesterday' })).isError).toBe(true);
      expect((await call('search_notes', { query: 'glacier', updated_since: '2026-99-99' })).isError).toBe(true);
    });

    it('sorts by recency when sort is "recent", combines filters, and keeps private redaction', async () => {
      const folder = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Filing cabinet 42' });
      const older = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: folder.id, title: 'Coral Reef Coral' });
      await s.pages.saveContent(older.id, docFromParagraphs(['Coral coral coral reef study']));
      const newer = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: folder.id, title: 'Field Update' });
      await s.pages.saveContent(
        newer.id,
        docFromParagraphs(['Brief coral mention <private>topsecret9911</private> visible text']),
      );
      const newestPrivateOnly = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: folder.id, title: 'Hidden Note' });
      await s.pages.saveContent(newestPrivateOnly.id, docFromParagraphs(['<private>coral only hidden</private>']));

      const outside = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Outside Coral' });
      await s.pages.saveContent(outside.id, docFromParagraphs(['Coral outside folder']));

      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_700_000_001_000, older.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_700_000_005_000, newer.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_700_000_009_000, newestPrivateOnly.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_700_000_010_000, outside.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_600_000_000_000, folder.id]);

      // Default relevance ranks the denser match first; sort: 'recent' orders newest first.
      const recentAll = (await call('search_notes', { query: 'coral', sort: 'recent' })).json() as { id: string; snippet: string }[];
      const expectedIds = new Set([outside.id, newer.id, older.id]);
      // Hybrid search may also return loosely related pages; only the matching pages must be ordered newest first.
      expect(recentAll.map((h) => h.id).filter((id) => expectedIds.has(id))).toEqual([outside.id, newer.id, older.id]);
      expect(recentAll.find((h) => h.id === newer.id)!.snippet).not.toContain('topsecret9911');
      expect(recentAll.some((h) => h.id === newestPrivateOnly.id)).toBe(false);

      // Combined: parent_id + kind + updated_since + sort + detail: 'index'.
      const combined = (
        await call('search_notes', {
          query: 'coral',
          parent_id: folder.id,
          kind: 'page',
          updated_since: new Date(1_700_000_000_000).toISOString(),
          sort: 'recent',
          detail: 'index',
        })
      ).json() as { id: string; kind: string; title: string }[];
      expect(combined).toEqual([
        { id: newer.id, kind: 'page', title: 'Field Update' },
        { id: older.id, kind: 'page', title: 'Coral Reef Coral' },
      ]);

      // Raising updated_since narrows the combined result to only the newer match.
      const combinedNarrow = (
        await call('search_notes', {
          query: 'coral',
          parent_id: folder.id,
          kind: 'page',
          updated_since: new Date(1_700_000_003_000).toISOString(),
          sort: 'recent',
        })
      ).json() as { id: string }[];
      expect(combinedNarrow.map((h) => h.id)).toEqual([newer.id]);

      // parent_id combined with a non-page kind yields an empty list (no non-page lives in a page subtree).
      expect((await call('search_notes', { query: 'coral', parent_id: folder.id, kind: 'task' })).json()).toEqual([]);

      // Invalid sort fails cleanly.
      expect((await call('search_notes', { query: 'coral', sort: 'alphabetical' })).isError).toBe(true);
    });
  });

  describe('list_recent_pages', () => {
    it('returns newest live pages with breadcrumbs, updated_at, 120-char private-stripped snippets and filters', async () => {
      const root = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Projects <private>pin123</private>' });
      const sub = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: root.id, title: 'Alpha' });
      const leaf = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: sub.id, title: 'Daily Log <private>secret</private>' });
      await s.pages.saveContent(
        leaf.id,
        docFromParagraphs([
          'Public opening text <private>vaultcode4455</private> followed by a long description that exceeds one hundred and twenty characters so we verify bounded snippet truncation works cleanly.',
        ]),
      );

      const standalone = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Standalone Note' });
      await s.pages.saveContent(standalone.id, docFromParagraphs(['Short standalone summary.']));

      const trashed = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: root.id, title: 'Trashed Recent' });
      await s.pages.saveContent(trashed.id, docFromParagraphs(['Should not appear']));
      await s.pages.trash(trashed.id);

      const archived = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Archived Recent' });
      await s.pages.setArchived(archived.id, true);

      const dbPage = await s.databases.createDatabase(ctx.workspaceId, 'Reading DB');

      // Other workspace must remain isolated.
      const otherWs = (await s.workspaces.create('Other')).id;
      const foreign = await s.pages.create({ workspaceId: otherWs, title: 'Foreign Recent' });
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_800_000_099_000, foreign.id]);

      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_800_000_001_000, root.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_800_000_002_000, sub.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_800_000_003_000, standalone.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_800_000_004_000, leaf.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_800_000_010_000, trashed.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_800_000_011_000, archived.id]);
      await s.db.run('UPDATE pages SET updated_at = ? WHERE id = ?', [1_800_000_012_000, dbPage.id]);

      const all = (await call('list_recent_pages')).json() as {
        pages: { id: string; title: string; path: string[]; updated_at: string; snippet: string }[];
        limit: number;
        has_more: boolean;
      };
      expect(all.limit).toBe(10);
      expect(all.has_more).toBe(false);
      expect(all.pages.map((p) => p.id)).toEqual([leaf.id, standalone.id, sub.id, root.id]);

      const leafEntry = all.pages[0];
      expect(leafEntry.title).toBe('Daily Log');
      expect(leafEntry.path).toEqual(['Projects', 'Alpha']);
      expect(leafEntry.updated_at).toBe(new Date(1_800_000_004_000).toISOString());
      expect(leafEntry.snippet.length).toBeLessThanOrEqual(120);
      expect(leafEntry.snippet).toContain('Public opening text');
      expect(leafEntry.snippet).not.toContain('vaultcode4455');
      expect(JSON.stringify(all)).not.toContain('pin123');
      expect(JSON.stringify(all)).not.toContain('secret');

      // Top-level page has an empty breadcrumb path.
      expect(all.pages[1]).toMatchObject({
        id: standalone.id,
        title: 'Standalone Note',
        path: [],
        snippet: 'Short standalone summary.',
      });

      // Subtree scoping via parent_id excludes standalone and root when scoped to sub.
      const scoped = (await call('list_recent_pages', { parent_id: sub.id })).json() as { pages: { id: string }[] };
      expect(scoped.pages.map((p) => p.id)).toEqual([leaf.id, sub.id]);

      // since filters by updated_at >= since.
      const sinceRes = (await call('list_recent_pages', { since: new Date(1_800_000_003_000).toISOString() })).json() as {
        pages: { id: string }[];
      };
      expect(sinceRes.pages.map((p) => p.id)).toEqual([leaf.id, standalone.id]);

      // Combined parent_id + since + limit + has_more.
      const limited = (
        await call('list_recent_pages', { parent_id: root.id, since: new Date(1_800_000_001_000).toISOString(), limit: 2 })
      ).json() as { pages: { id: string }[]; limit: number; has_more: boolean };
      expect(limited.pages.map((p) => p.id)).toEqual([leaf.id, sub.id]);
      expect(limited.limit).toBe(2);
      expect(limited.has_more).toBe(true);

      // Validation & workspace isolation errors.
      expect((await call('list_recent_pages', { parent_id: foreign.id })).isError).toBe(true);
      expect((await call('list_recent_pages', { parent_id: trashed.id })).isError).toBe(true);
      expect((await call('list_recent_pages', { since: 'not-a-date' })).isError).toBe(true);
    });
  });

  describe('get_page_outline_tree', () => {
    it('builds nested trees respecting depth, parent_id, child_count, private titles, trash and workspace isolation', async () => {
      const rootA = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Workspace Root <private>hide</private>' });
      const lvl2 = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: rootA.id, title: 'Level 2' });
      const lvl3 = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: lvl2.id, title: 'Level 3' });
      const lvl4 = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: lvl3.id, title: 'Level 4' });
      await s.pages.create({ workspaceId: ctx.workspaceId, parentId: lvl4.id, title: 'Level 5' });
      const rootB = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Second Root' });

      const trashed = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: rootA.id, title: 'Trashed Child' });
      await s.pages.trash(trashed.id);
      const archived = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: rootA.id, title: 'Archived Child' });
      await s.pages.setArchived(archived.id, true);

      const otherWs = (await s.workspaces.create('Other')).id;
      const foreign = await s.pages.create({ workspaceId: otherWs, title: 'Foreign Page' });

      // Default depth is 2: roots + their direct children; lvl2 reports child_count: 1 with children: [].
      const d2 = (await call('get_page_outline_tree')).json();
      expect(d2).toEqual({
        parent_id: null,
        depth: 2,
        node_count: 3,
        truncated: false,
        nodes: [
          {
            id: rootA.id,
            title: 'Workspace Root',
            child_count: 1,
            children: [
              {
                id: lvl2.id,
                title: 'Level 2',
                child_count: 1,
                children: [],
              },
            ],
          },
          {
            id: rootB.id,
            title: 'Second Root',
            child_count: 0,
            children: [],
          },
        ],
      });
      expect(JSON.stringify(d2)).not.toContain('hide');
      expect(JSON.stringify(d2)).not.toContain('Foreign Page');
      expect(JSON.stringify(d2)).not.toContain('Trashed Child');
      expect(JSON.stringify(d2)).not.toContain('Archived Child');

      // Depth 1 returns only roots with accurate child_count.
      const d1 = (await call('get_page_outline_tree', { depth: 1 })).json();
      expect(d1.depth).toBe(1);
      expect(d1.node_count).toBe(2);
      expect(d1.nodes[0]).toMatchObject({ id: rootA.id, child_count: 1, children: [] });

      // Depth 4 (and clamping > 4) expands down to level 4, stopping before level 5.
      const d4 = (await call('get_page_outline_tree', { depth: 10 })).json();
      expect(d4.depth).toBe(4);
      expect(d4.node_count).toBe(5);
      expect(d4.nodes[0].children[0].children[0].children[0]).toEqual({
        id: lvl4.id,
        title: 'Level 4',
        child_count: 1,
        children: [],
      });

      // parent_id scopes the outline to that page's direct children and below.
      const sub = (await call('get_page_outline_tree', { parent_id: rootA.id, depth: 2 })).json();
      expect(sub).toEqual({
        parent_id: rootA.id,
        depth: 2,
        node_count: 2,
        truncated: false,
        nodes: [
          {
            id: lvl2.id,
            title: 'Level 2',
            child_count: 1,
            children: [
              {
                id: lvl3.id,
                title: 'Level 3',
                child_count: 1,
                children: [],
              },
            ],
          },
        ],
      });

      // Invalid depth, foreign or trashed parent_id fail cleanly.
      expect((await call('get_page_outline_tree', { depth: 'deep' })).isError).toBe(true);
      expect((await call('get_page_outline_tree', { parent_id: foreign.id })).isError).toBe(true);
      expect((await call('get_page_outline_tree', { parent_id: trashed.id })).isError).toBe(true);
    });

    it('caps outline tree at 300 nodes with truncated flag and preserves top-level siblings via BFS', async () => {
      const nowTs = Date.now();
      await s.db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO pages(id, workspace_id, parent_id, kind, title, content_text, sort_order, created_at, updated_at)
           VALUES (?, ?, NULL, 'page', 'Huge Folder', '', 1, ?, ?)`,
          ['huge-root', ctx.workspaceId, nowTs, nowTs],
        );
        await tx.run(
          `INSERT INTO pages(id, workspace_id, parent_id, kind, title, content_text, sort_order, created_at, updated_at)
           VALUES (?, ?, NULL, 'page', 'Sibling Folder', '', 2, ?, ?)`,
          ['sibling-root', ctx.workspaceId, nowTs, nowTs],
        );
        for (let i = 0; i < 305; i++) {
          await tx.run(
            `INSERT INTO pages(id, workspace_id, parent_id, kind, title, content_text, sort_order, created_at, updated_at)
             VALUES (?, ?, 'huge-root', 'page', ?, '', ?, ?, ?)`,
            [`child-${i}`, ctx.workspaceId, `Child ${i}`, i, nowTs, nowTs],
          );
        }
      });

      // 2 roots + 305 children = 307 nodes at depth 2 -> capped at 300, truncated: true.
      const capped = (await call('get_page_outline_tree', { depth: 2 })).json() as {
        nodes: { id: string; child_count: number; children: { id: string }[] }[];
        node_count: number;
        truncated: boolean;
      };
      expect(capped.node_count).toBe(300);
      expect(capped.truncated).toBe(true);
      // BFS includes both top-level folders before expanding 298 children of Huge Folder.
      expect(capped.nodes.map((n) => n.id)).toEqual(['huge-root', 'sibling-root']);
      expect(capped.nodes[0].child_count).toBe(305);
      expect(capped.nodes[0].children).toHaveLength(298);

      // Exactly 300 nodes under huge-root (after trimming 5) is NOT truncated.
      await s.db.run(`DELETE FROM pages WHERE id IN ('child-300', 'child-301', 'child-302', 'child-303', 'child-304')`);
      const exact = (await call('get_page_outline_tree', { parent_id: 'huge-root', depth: 1 })).json() as {
        nodes: { id: string }[];
        node_count: number;
        truncated: boolean;
      };
      expect(exact.node_count).toBe(300);
      expect(exact.nodes).toHaveLength(300);
      expect(exact.truncated).toBe(false);
    });
  });
});
