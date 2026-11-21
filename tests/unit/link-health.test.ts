import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { PAGE_LINK_PREFIX, type DocNode } from '../../src/core/doc';
import { memoryStore } from '../helpers';

function docLinkingTo(targetId: string, kind: 'link' | 'mention' = 'link'): DocNode {
  if (kind === 'mention') {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'pageMention', attrs: { id: targetId, label: 'Target' } }] }],
    };
  }
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'text', text: 'Target', marks: [{ type: 'link', attrs: { href: `${PAGE_LINK_PREFIX}${targetId}` } }] },
        ],
      },
    ],
  };
}

describe('PageRepo.linkHealth', () => {
  let s: Repos;
  let ws: string;

  beforeEach(async () => {
    s = await memoryStore();
    ws = (await s.workspaces.create('Main')).id;
  });

  it('returns empty lists for healthy links and nested pages', async () => {
    const parent = await s.pages.create({ workspaceId: ws, title: 'Folder' });
    const child = await s.pages.create({ workspaceId: ws, parentId: parent.id, title: 'Child' });
    const target = await s.pages.create({ workspaceId: ws, title: 'Reference' });
    await s.pages.saveContent(child.id, docLinkingTo(target.id, 'link'));
    await s.pages.saveContent(parent.id, docLinkingTo(target.id, 'mention'));

    expect(await s.pages.linkHealth(ws)).toEqual({ brokenLinks: [], orphans: [] });
  });

  it('reports a link as broken after trashing its target and repairs it after restore', async () => {
    const target = await s.pages.create({ workspaceId: ws, title: 'Glossary' });
    const source = await s.pages.create({ workspaceId: ws, title: 'Overview' });
    await s.pages.saveContent(source.id, docLinkingTo(target.id));

    await s.pages.trash(target.id);
    const broken = await s.pages.linkHealth(ws);
    expect(broken.orphans).toEqual([]);
    expect(broken.brokenLinks).toEqual([
      {
        source_id: source.id,
        source_title: 'Overview',
        target_id: target.id,
        target_title: 'Glossary',
        reason: 'trashed',
      },
    ]);

    await s.pages.restore(target.id);
    const repaired = await s.pages.linkHealth(ws);
    expect(repaired).toEqual({ brokenLinks: [], orphans: [] });
  });

  it('detects missing targets in page_links and ignores links from trashed sources', async () => {
    const liveSource = await s.pages.create({ workspaceId: ws, title: 'Live Source' });
    const trashedSource = await s.pages.create({ workspaceId: ws, title: 'Trashed Source' });
    const trashedTarget = await s.pages.create({ workspaceId: ws, title: 'Trashed Target' });
    await s.pages.saveContent(trashedSource.id, docLinkingTo(trashedTarget.id));
    await s.pages.trash(trashedSource.id);
    await s.pages.trash(trashedTarget.id);

    await s.db.run('PRAGMA foreign_keys = OFF');
    await s.db.run('INSERT INTO page_links(source_id, target_id) VALUES (?, ?)', [liveSource.id, 'missing-target-id']);
    await s.db.run('PRAGMA foreign_keys = ON');

    const report = await s.pages.linkHealth(ws);
    expect(report.brokenLinks).toEqual([
      {
        source_id: liveSource.id,
        source_title: 'Live Source',
        target_id: 'missing-target-id',
        target_title: null,
        reason: 'missing',
      },
    ]);
  });

  it('detects orphan pages with trashed or missing parents and ignores trashed sub-pages', async () => {
    const trashedParent = await s.pages.create({ workspaceId: ws, title: 'Old Folder' });
    const strandedChild = await s.pages.create({ workspaceId: ws, parentId: trashedParent.id, title: 'Stranded Child' });
    // Simulate a parent trashed without trashing its child.
    await s.db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [Date.now(), trashedParent.id]);

    // Normal recursive trash should NOT report the trashed child as an orphan.
    const normalParent = await s.pages.create({ workspaceId: ws, title: 'Deleted Tree' });
    await s.pages.create({ workspaceId: ws, parentId: normalParent.id, title: 'Deleted Sub' });
    await s.pages.trash(normalParent.id);

    // Simulate a live page pointing to a non-existent parent.
    const missingParentChild = await s.pages.create({ workspaceId: ws, title: 'Detached Note' });
    await s.db.run('PRAGMA foreign_keys = OFF');
    await s.db.run('UPDATE pages SET parent_id = ? WHERE id = ?', ['ghost-parent-id', missingParentChild.id]);
    await s.db.run('PRAGMA foreign_keys = ON');

    const report = await s.pages.linkHealth(ws);
    expect(report.brokenLinks).toEqual([]);
    expect(report.orphans).toEqual([
      {
        id: missingParentChild.id,
        title: 'Detached Note',
        parent_id: 'ghost-parent-id',
        parent_title: null,
        reason: 'missing',
      },
      {
        id: strandedChild.id,
        title: 'Stranded Child',
        parent_id: trashedParent.id,
        parent_title: 'Old Folder',
        reason: 'trashed',
      },
    ]);

    // Restoring the trashed parent clears its child's orphan status.
    await s.db.run('UPDATE pages SET deleted_at = NULL WHERE id = ?', [trashedParent.id]);
    const afterRestore = await s.pages.linkHealth(ws);
    expect(afterRestore.orphans.map((o) => o.id)).toEqual([missingParentChild.id]);
  });

  it('scopes link health to the requested workspace without leaking other workspaces', async () => {
    const otherWs = (await s.workspaces.create('Other')).id;
    const otherSource = await s.pages.create({ workspaceId: otherWs, title: 'Other Source' });
    const otherTarget = await s.pages.create({ workspaceId: otherWs, title: 'Other Secret Target' });
    await s.pages.saveContent(otherSource.id, docLinkingTo(otherTarget.id));
    await s.pages.trash(otherTarget.id);

    const otherParent = await s.pages.create({ workspaceId: otherWs, title: 'Other Parent' });
    await s.pages.create({ workspaceId: otherWs, parentId: otherParent.id, title: 'Other Orphan' });
    await s.db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [Date.now(), otherParent.id]);

    expect(await s.pages.linkHealth(ws)).toEqual({ brokenLinks: [], orphans: [] });

    // Cross-workspace link in page_links must be reported as missing without leaking the other workspace's title.
    const mySource = await s.pages.create({ workspaceId: ws, title: 'My Source' });
    const otherLive = await s.pages.create({ workspaceId: otherWs, title: 'Confidential Other Page' });
    await s.db.run('INSERT INTO page_links(source_id, target_id) VALUES (?, ?)', [mySource.id, otherLive.id]);

    const crossReport = await s.pages.linkHealth(ws);
    expect(crossReport.orphans).toEqual([]);
    expect(crossReport.brokenLinks).toEqual([
      {
        source_id: mySource.id,
        source_title: 'My Source',
        target_id: otherLive.id,
        target_title: null,
        reason: 'missing',
      },
    ]);
  });
});
