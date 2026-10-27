import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { memoryStore } from '../helpers';
import { docFromParagraphs, PAGE_LINK_PREFIX } from '../../src/core/doc';
import { search } from '../../src/search/search';

let s: Repos;
let ws: string;

beforeEach(async () => {
  s = await memoryStore();
  ws = (await s.workspaces.create('Main')).id;
});

describe('pages', () => {
  it('creates nested pages and resolves breadcrumbs', async () => {
    const a = await s.pages.create({ workspaceId: ws, title: 'A' });
    const b = await s.pages.create({ workspaceId: ws, parentId: a.id, title: 'B' });
    const c = await s.pages.create({ workspaceId: ws, parentId: b.id, title: 'C' });
    const chain = await s.pages.ancestors(c.id);
    expect(chain.map((p) => p.title)).toEqual(['A', 'B', 'C']);
    expect((await s.pages.listTree(ws)).length).toBe(3);
  });

  it('rejects a parent in another workspace and moves that would create cycles', async () => {
    const other = await s.workspaces.create('Other');
    const foreign = await s.pages.create({ workspaceId: other.id, title: 'X' });
    await expect(s.pages.create({ workspaceId: ws, parentId: foreign.id })).rejects.toThrow(/another workspace/);
    const a = await s.pages.create({ workspaceId: ws, title: 'A' });
    const b = await s.pages.create({ workspaceId: ws, parentId: a.id, title: 'B' });
    await expect(s.pages.move(a.id, b.id)).rejects.toThrow(/own sub-page/);
    await expect(s.pages.move(a.id, a.id)).rejects.toThrow();
  });

  it('autosaves content, updates search and keeps snapshots', async () => {
    const p = await s.pages.create({ workspaceId: ws, title: 'Notes' });
    await s.pages.saveContent(p.id, docFromParagraphs(['first version about volcanoes']));
    await s.pages.saveContent(p.id, docFromParagraphs(['second version about glaciers']));
    const got = await s.pages.get(p.id);
    expect(got?.content_text).toContain('glaciers');
    const hits = await search(s.db, 'glaciers', { workspaceId: ws, mode: 'fulltext' });
    expect(hits.some((h) => h.refId === p.id)).toBe(true);
    const stale = await search(s.db, 'volcanoes', { workspaceId: ws, mode: 'fulltext' });
    expect(stale.some((h) => h.refId === p.id)).toBe(false);
    expect((await s.pages.listSnapshots(p.id)).length).toBeGreaterThanOrEqual(1);
  });

  it('semantic search reflects edits (local vector cache is content-keyed)', async () => {
    const p = await s.pages.create({ workspaceId: ws, title: 'Field log' });
    await s.pages.saveContent(p.id, docFromParagraphs(['volcano basalt magma eruption lava']));
    const first = await search(s.db, 'volcano lava', { workspaceId: ws, mode: 'semantic' });
    expect(first.some((h) => h.refId === p.id)).toBe(true);
    await s.pages.saveContent(p.id, docFromParagraphs(['tidal estuary salt marsh heron']));
    const stale = await search(s.db, 'volcano lava', { workspaceId: ws, mode: 'semantic' });
    expect(stale.some((h) => h.refId === p.id)).toBe(false);
    const fresh = await search(s.db, 'estuary heron', { workspaceId: ws, mode: 'semantic' });
    expect(fresh.some((h) => h.refId === p.id)).toBe(true);
  });

  it('tracks links and backlinks from mentions and internal links', async () => {
    const target = await s.pages.create({ workspaceId: ws, title: 'Target' });
    const src = await s.pages.create({ workspaceId: ws, title: 'Source' });
    await s.pages.saveContent(src.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'pageMention', attrs: { id: target.id, label: 'Target' } },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'missing', marks: [{ type: 'link', attrs: { href: PAGE_LINK_PREFIX + 'does-not-exist' } }] },
          ],
        },
      ],
    });
    const back = await s.pages.backlinks(target.id);
    expect(back.map((p) => p.id)).toEqual([src.id]);
  });

  it('moves pages to trash recursively, restores and purges', async () => {
    const a = await s.pages.create({ workspaceId: ws, title: 'Parent' });
    const b = await s.pages.create({ workspaceId: ws, parentId: a.id, title: 'Child' });
    await s.pages.trash(a.id);
    expect((await s.pages.listTree(ws)).length).toBe(0);
    const trash = await s.pages.listTrash(ws);
    expect(trash.map((p) => p.id)).toEqual([a.id]);
    expect(await search(s.db, 'Child', { workspaceId: ws, mode: 'keyword' })).toHaveLength(0);
    await s.pages.restore(a.id);
    expect((await s.pages.listTree(ws)).length).toBe(2);
    expect((await search(s.db, 'Child', { workspaceId: ws, mode: 'keyword' })).length).toBe(1);
    await expect(s.pages.purge(a.id)).rejects.toThrow(/trash/);
    await s.pages.trash(a.id);
    await s.pages.purge(a.id);
    expect(await s.pages.get(b.id)).toBeUndefined();
  });

  it('restores a child to the root when its parent is still trashed', async () => {
    const a = await s.pages.create({ workspaceId: ws, title: 'P' });
    const b = await s.pages.create({ workspaceId: ws, parentId: a.id, title: 'C' });
    await s.pages.trash(b.id);
    await s.pages.trash(a.id);
    await s.pages.restore(b.id);
    expect((await s.pages.get(b.id))?.parent_id).toBeNull();
  });

  it('manages tags, favorites, duplicates and recents', async () => {
    const p = await s.pages.create({ workspaceId: ws, title: 'Tagged', content: docFromParagraphs(['body']) });
    const tag = await s.pages.addTag(p.id, '#research');
    await s.pages.addTag(p.id, 'research');
    expect((await s.pages.pageTags(p.id)).map((t) => t.name)).toEqual(['research']);
    await s.pages.updateMeta(p.id, { is_favorite: 1 });
    expect((await s.pages.listFavorites(ws)).length).toBe(1);
    const copy = await s.pages.duplicate(p.id);
    expect(copy.title).toBe('Tagged (copy)');
    expect(copy.content_text).toBe('body');
    await s.pages.touchRecent(p.id);
    expect((await s.pages.listRecentVisited(ws))[0].id).toBe(p.id);
    await s.pages.removeTag(p.id, tag.id);
    expect(await s.pages.listTags(ws)).toHaveLength(0);
  });

  it('deleting a workspace cascades all content', async () => {
    await s.pages.create({ workspaceId: ws, title: 'gone' });
    await s.tasks.create({ workspaceId: ws, title: 'task' });
    await s.workspaces.remove(ws);
    expect(await s.db.all('SELECT * FROM pages')).toHaveLength(0);
    expect(await s.db.all('SELECT * FROM tasks')).toHaveLength(0);
    expect(await s.db.all('SELECT * FROM search_index')).toHaveLength(0);
  });
});
