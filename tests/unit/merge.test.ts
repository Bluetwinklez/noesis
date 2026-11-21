import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { docFromParagraphs, PAGE_LINK_PREFIX, type DocNode } from '../../src/core/doc';
import { buildMergedDoc, demoteHeadingLevel, demoteHeadings, prepareSourceBlocks } from '../../src/core/merge';
import { search } from '../../src/search/search';
import { translate } from '../../src/i18n';
import { memoryStore } from '../helpers';

describe('merge pure helpers', () => {
  it('demotes heading levels by one and caps at level 4', () => {
    expect(demoteHeadingLevel(1)).toBe(2);
    expect(demoteHeadingLevel(2)).toBe(3);
    expect(demoteHeadingLevel(3)).toBe(4);
    expect(demoteHeadingLevel(4)).toBe(4);
    expect(demoteHeadingLevel(5)).toBe(4);
    expect(demoteHeadingLevel(6)).toBe(4);
  });

  it('skips a leading H1 equal to the source title, keeps differing H1s, and demotes nested headings without mutating inputs', () => {
    const matching: DocNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '  Field   Notes ' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Methods' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Sampling' }] },
        { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Deep Detail' }] },
        {
          type: 'blockquote',
          content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Quoted Section' }] }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body text.' }] },
      ],
    };
    const snapshot = JSON.stringify(matching);
    const prepared = prepareSourceBlocks(matching, 'field notes');
    expect(JSON.stringify(matching)).toBe(snapshot);

    expect(prepared.map((n) => (n.type === 'heading' ? `h${n.attrs?.level}` : n.type))).toEqual([
      'h3',
      'h4',
      'h4',
      'blockquote',
      'paragraph',
    ]);
    expect(prepared[3].content?.[0].attrs?.level).toBe(3);

    // Leading H1 with a different title is kept and demoted to H2.
    const differing: DocNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Different Heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Still here.' }] },
      ],
    };
    const keptH1 = prepareSourceBlocks(differing, 'Source Title');
    expect(keptH1[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(keptH1[1]).toMatchObject({ type: 'paragraph' });

    // Leading H2 matching the source title is NOT skipped (only H1 is skipped) and demotes to H3.
    const leadingH2: DocNode = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Source Title' }] }],
    };
    const keptH2 = prepareSourceBlocks(leadingH2, 'Source Title');
    expect(keptH2).toHaveLength(1);
    expect(keptH2[0]).toMatchObject({ type: 'heading', attrs: { level: 3 } });

    const single = demoteHeadings({ type: 'heading', attrs: { level: 5 }, content: [{ type: 'text', text: 'Low' }] });
    expect(single.attrs?.level).toBe(4);
  });

  it('builds a merged doc preserving source order and handling empty target/sources', () => {
    const merged = buildMergedDoc(
      { type: 'doc', content: [{ type: 'paragraph' }] },
      [
        { title: 'First', doc: docFromParagraphs(['Alpha']) },
        { title: '', doc: null },
        { title: 'Third', doc: docFromParagraphs(['Gamma']) },
      ],
    );
    expect(merged.content?.map((n) => (n.type === 'heading' ? `h${n.attrs?.level}:${n.content?.[0].text}` : n.content?.[0].text))).toEqual([
      'h2:First',
      'Alpha',
      'h2:Untitled',
      'h2:Third',
      'Gamma',
    ]);
  });

  it('provides English and Turkish strings for merge approval and graph activity', () => {
    expect(translate('en', 'graph.action.merge_pages')).toBe('merged into');
    expect(translate('tr', 'graph.action.merge_pages')).toBe('birleştirdi');
    expect(translate('en', 'mcp.approve.body.merge', { client: 'Codex', page: 'Notes' })).toContain('Notes');
    expect(translate('tr', 'mcp.approve.body.merge', { client: 'Codex', page: 'Notlar' })).toContain('Notlar');
  });
});

describe('PageRepo.mergePages', () => {
  let s: Repos;
  let ws: string;

  beforeEach(async () => {
    s = await memoryStore();
    ws = (await s.workspaces.create('Merge WS')).id;
  });

  it('appends sources in order under H2s, demotes headings, skips matching leading H1 and preserves a pre-merge snapshot', async () => {
    const target = await s.pages.create({ workspaceId: ws, title: 'Oceanography Hub' });
    await s.pages.saveContent(target.id, docFromParagraphs(['Target introduction paragraph.']));

    const srcA = await s.pages.create({ workspaceId: ws, title: 'Currents' });
    await s.pages.saveContent(srcA.id, {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Currents' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Gulf Stream observations.' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Deep Water' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Thermohaline' }] },
        { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Salinity Floor' }] },
      ],
    });

    const srcB = await s.pages.create({ workspaceId: ws, title: 'Tides' });
    await s.pages.saveContent(srcB.id, {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Lunar Cycle' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Spring and neap tidal ranges.' }] },
      ],
    });

    const res = await s.pages.mergePages(ws, target.id, [srcB.id, srcA.id]);
    expect(res).toMatchObject({
      targetId: target.id,
      targetTitle: 'Oceanography Hub',
      mergedSourceIds: [srcB.id, srcA.id],
      mergedSourceTitles: ['Tides', 'Currents'],
      movedSubpageCount: 0,
    });

    const updated = (await s.pages.get(target.id))!;
    const doc = JSON.parse(updated.content_json!) as DocNode;
    const summary = (doc.content ?? []).map((n) =>
      n.type === 'heading' ? `h${n.attrs?.level}:${n.content?.[0].text}` : `p:${n.content?.[0].text}`,
    );
    expect(summary).toEqual([
      'p:Target introduction paragraph.',
      'h2:Tides',
      'h2:Lunar Cycle',
      'p:Spring and neap tidal ranges.',
      'h2:Currents',
      'p:Gulf Stream observations.',
      'h3:Deep Water',
      'h4:Thermohaline',
      'h4:Salinity Floor',
    ]);

    // A pre-merge snapshot was recorded for the target page.
    const snapshots = await s.pages.listSnapshots(target.id);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0].content_json).toContain('Target introduction paragraph.');
    expect(snapshots[0].content_json).not.toContain('Gulf Stream');
  });

  it('re-points internal links in page_links and in page bodies (link marks and mentions) and leaves link health clean', async () => {
    const target = await s.pages.create({ workspaceId: ws, title: 'Target Guide' });
    await s.pages.saveContent(target.id, docFromParagraphs(['Main guide text.']));

    const src1 = await s.pages.create({ workspaceId: ws, title: 'Draft One' });
    const src2 = await s.pages.create({ workspaceId: ws, title: 'Draft Two' });
    const other = await s.pages.create({ workspaceId: ws, title: 'External Ref' });

    // src1 links to src2 and to other.
    await s.pages.saveContent(src1.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'text', text: 'draft two', marks: [{ type: 'link', attrs: { href: `${PAGE_LINK_PREFIX}${src2.id}` } }] },
            { type: 'text', text: ' and ' },
            { type: 'pageMention', attrs: { id: other.id, label: 'External Ref' } },
          ],
        },
      ],
    });
    await s.pages.saveContent(src2.id, docFromParagraphs(['Second draft notes.']));

    // hub links to src1 via a link mark and to src2 via a pageMention.
    const hub = await s.pages.create({ workspaceId: ws, title: 'Index Hub' });
    await s.pages.saveContent(hub.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            { type: 'text', text: 'draft one', marks: [{ type: 'link', attrs: { href: `${PAGE_LINK_PREFIX}${src1.id}` } }] },
            { type: 'text', text: ' and ' },
            { type: 'pageMention', attrs: { id: src2.id, label: 'Draft Two' } },
          ],
        },
      ],
    });

    // rawLinker already links to target (deduplication test); rawOnlyLinker only has a raw page_links row to src1.
    const rawLinker = await s.pages.create({ workspaceId: ws, title: 'Raw Linker' });
    await s.db.run('INSERT INTO page_links(source_id, target_id) VALUES (?, ?)', [rawLinker.id, src1.id]);
    await s.db.run('INSERT INTO page_links(source_id, target_id) VALUES (?, ?)', [rawLinker.id, target.id]);
    const rawOnlyLinker = await s.pages.create({ workspaceId: ws, title: 'Raw Only Linker' });
    await s.db.run('INSERT INTO page_links(source_id, target_id) VALUES (?, ?)', [rawOnlyLinker.id, src1.id]);

    const res = await s.pages.mergePages(ws, target.id, [src1.id, src2.id]);
    expect(res.redirectedPages).toBe(1);
    expect(res.redirectedLinks).toBe(3); // 2 in hub + 1 in src1->src2 rewritten inside merged target

    // hub's body links and mention now point to target.
    const hubAfter = (await s.pages.get(hub.id))!;
    expect(hubAfter.content_json).toContain(`${PAGE_LINK_PREFIX}${target.id}`);
    expect(hubAfter.content_json).not.toContain(src1.id);
    expect(hubAfter.content_json).not.toContain(src2.id);
    const hubDoc = JSON.parse(hubAfter.content_json!) as DocNode;
    expect(hubDoc.content?.[0].content?.[3]).toEqual({
      type: 'pageMention',
      attrs: { id: target.id, label: 'Target Guide' },
    });

    // Target's merged body rewrote src1->src2 to target and retained the link to other.
    const targetAfter = (await s.pages.get(target.id))!;
    expect(targetAfter.content_json).not.toContain(src2.id);
    expect(targetAfter.content_json).toContain(`${PAGE_LINK_PREFIX}${target.id}`);

    // page_links rows re-pointed cleanly with no stale links to merged sources and no self-link on target.
    expect(await s.db.all('SELECT * FROM page_links WHERE target_id IN (?, ?)', [src1.id, src2.id])).toEqual([]);
    expect(await s.db.all('SELECT * FROM page_links WHERE source_id = ? AND target_id = ?', [target.id, target.id])).toEqual([]);
    expect((await s.pages.backlinks(target.id)).map((p) => p.id).sort()).toEqual([hub.id, rawLinker.id, rawOnlyLinker.id].sort());
    expect((await s.pages.backlinks(other.id)).map((p) => p.id)).toEqual([target.id]);

    // Link health reports zero broken links and zero orphans.
    expect(await s.pages.linkHealth(ws)).toEqual({ brokenLinks: [], orphans: [] });
  });

  it('moves source sub-pages under target, trashes sources restorably and updates search', async () => {
    const target = await s.pages.create({ workspaceId: ws, title: 'Master Plan' });
    await s.pages.saveContent(target.id, docFromParagraphs(['Overview of the expedition.']));
    const existingChild = await s.pages.create({ workspaceId: ws, parentId: target.id, title: 'Existing Child' });

    const src1 = await s.pages.create({ workspaceId: ws, title: 'Botany Notes' });
    await s.pages.saveContent(src1.id, docFromParagraphs(['Unique bryophyte specimen catalogue.']));
    const child1 = await s.pages.create({ workspaceId: ws, parentId: src1.id, title: 'Mosses' });
    const grandchild1 = await s.pages.create({ workspaceId: ws, parentId: child1.id, title: 'Sphagnum' });

    // Nested source pair: src2 is a child of src1, both merged into target; src2Child must move to target.
    const src2 = await s.pages.create({ workspaceId: ws, parentId: src1.id, title: 'Lichen Addendum' });
    await s.pages.saveContent(src2.id, docFromParagraphs(['Unique foliose lichen observations.']));
    const src2Child = await s.pages.create({ workspaceId: ws, parentId: src2.id, title: 'Crustose' });

    const res = await s.pages.mergePages(ws, target.id, [src1.id, src2.id]);
    expect(res.movedSubpageCount).toBe(2); // child1 and src2Child

    // Sub-pages moved under target; grandchild stays under child1.
    expect((await s.pages.get(existingChild.id))!.parent_id).toBe(target.id);
    expect((await s.pages.get(child1.id))!.parent_id).toBe(target.id);
    expect((await s.pages.get(grandchild1.id))!.parent_id).toBe(child1.id);
    expect((await s.pages.get(src2Child.id))!.parent_id).toBe(target.id);
    expect((await s.pages.get(child1.id))!.deleted_at).toBeNull();
    expect((await s.pages.get(src2Child.id))!.deleted_at).toBeNull();

    // Sources are trashed (not permanently deleted).
    expect((await s.pages.get(src1.id))!.deleted_at).not.toBeNull();
    expect((await s.pages.get(src2.id))!.deleted_at).not.toBeNull();
    expect((await s.pages.listTrash(ws)).map((p) => p.id)).toContain(src1.id);

    // Search finds merged source content under target, not under trashed sources.
    const bryophyteHits = await search(s.db, 'bryophyte', { workspaceId: ws, mode: 'fulltext' });
    expect(bryophyteHits.map((h) => h.refId)).toEqual([target.id]);
    const lichenHits = await search(s.db, 'foliose', { workspaceId: ws, mode: 'fulltext' });
    expect(lichenHits.map((h) => h.refId)).toEqual([target.id]);

    // Trashed sources remain restorable with their original content intact.
    await s.pages.restore(src1.id);
    const restored = (await s.pages.get(src1.id))!;
    expect(restored.deleted_at).toBeNull();
    expect(restored.content_text).toContain('bryophyte');
  });

  it('rejects cycles, target in sources, cross-workspace ids, trashed pages, and databases without partial writes', async () => {
    const parent = await s.pages.create({ workspaceId: ws, title: 'Parent' });
    const child = await s.pages.create({ workspaceId: ws, parentId: parent.id, title: 'Child' });
    const grandchild = await s.pages.create({ workspaceId: ws, parentId: child.id, title: 'Grandchild' });
    const sibling = await s.pages.create({ workspaceId: ws, title: 'Sibling' });
    await s.pages.saveContent(sibling.id, docFromParagraphs(['Sibling body']));
    const trashed = await s.pages.create({ workspaceId: ws, title: 'Trashed' });
    await s.pages.trash(trashed.id);
    const dbPage = await s.databases.createDatabase(ws, 'Tracker');

    const otherWs = (await s.workspaces.create('Other')).id;
    const foreign = await s.pages.create({ workspaceId: otherWs, title: 'Foreign' });

    // Empty source list & target in sources.
    await expect(s.pages.mergePages(ws, sibling.id, [])).rejects.toThrow(/At least one/);
    await expect(s.pages.mergePages(ws, sibling.id, [sibling.id])).rejects.toThrow(/itself/);
    await expect(s.pages.mergePages(ws, sibling.id, [parent.id, sibling.id])).rejects.toThrow(/itself/);

    // Cycles: direct child or deep descendant as target.
    await expect(s.pages.mergePages(ws, child.id, [parent.id])).rejects.toThrow(/sub-page/);
    await expect(s.pages.mergePages(ws, grandchild.id, [parent.id])).rejects.toThrow(/sub-page/);

    // Cross-workspace ids.
    await expect(s.pages.mergePages(ws, foreign.id, [sibling.id])).rejects.toThrow(/another workspace/);
    await expect(s.pages.mergePages(ws, sibling.id, [foreign.id])).rejects.toThrow(/another workspace/);

    // Trashed target or source.
    await expect(s.pages.mergePages(ws, trashed.id, [sibling.id])).rejects.toThrow(/trashed/);
    await expect(s.pages.mergePages(ws, sibling.id, [trashed.id])).rejects.toThrow(/trashed/);

    // Database target or source.
    await expect(s.pages.mergePages(ws, dbPage.id, [sibling.id])).rejects.toThrow(/database/);
    await expect(s.pages.mergePages(ws, sibling.id, [dbPage.id])).rejects.toThrow(/database/);

    // Atomicity: a batch containing one valid source and one invalid source rolls back completely.
    await expect(s.pages.mergePages(ws, parent.id, [sibling.id, trashed.id])).rejects.toThrow(/trashed/);
    expect((await s.pages.get(sibling.id))!.deleted_at).toBeNull();
    expect((await s.pages.get(parent.id))!.content_text).toBe('');
  });
});
