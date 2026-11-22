import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { docFromParagraphs, PAGE_LINK_PREFIX, type DocNode } from '../../src/core/doc';
import {
  findAffectedBacklinks,
  findDuplicateGroups,
  findWorkspaceDuplicates,
  normalizeDuplicateText,
  rewriteDocPageLinks,
  trashDuplicateCopies,
  type DuplicatePageInput,
} from '../../src/core/duplicates';
import { memoryStore } from '../helpers';

function makeRow(overrides: Partial<DuplicatePageInput> & { id: string }): DuplicatePageInput {
  return {
    parent_id: null,
    kind: 'page',
    title: 'Untitled',
    content_text: '',
    created_at: 1000,
    deleted_at: null,
    ...overrides,
  };
}

describe('duplicates pure helpers', () => {
  it('normalises whitespace and case consistently', () => {
    expect(normalizeDuplicateText('  Hello\n\t  WORLD  ')).toBe('hello world');
    expect(normalizeDuplicateText('')).toBe('');
  });

  it('groups exact and whitespace/case-insensitive duplicates while ignoring short, trashed and database pages', () => {
    const folder = makeRow({ id: 'folder', title: 'Research', content_text: '', created_at: 100 });
    const sub = makeRow({ id: 'sub', parent_id: 'folder', title: '2026', content_text: '', created_at: 150 });

    const rows: DuplicatePageInput[] = [
      folder,
      sub,
      // Same normalised title & text (whitespace/case differences), newer listed before older.
      makeRow({
        id: 'p-new',
        parent_id: 'sub',
        title: '  solar   NOTES ',
        content_text: 'Photovoltaic   panels convert\nsunlight into ELECTRICITY.',
        created_at: 3000,
      }),
      makeRow({
        id: 'p-old',
        parent_id: 'folder',
        title: 'Solar Notes',
        content_text: 'Photovoltaic panels convert sunlight into electricity.',
        created_at: 2000,
      }),
      // Same text, different titles.
      makeRow({
        id: 'd1',
        title: 'Draft One',
        content_text: 'Wind turbines generate electricity from moving air currents.',
        created_at: 4000,
      }),
      makeRow({
        id: 'd2',
        title: 'Final Copy',
        content_text: 'Wind turbines generate electricity from moving air currents.',
        created_at: 5000,
      }),
      // Short pages (< 20 chars) ignored.
      makeRow({ id: 's1', title: 'Stub', content_text: 'Too short', created_at: 1000 }),
      makeRow({ id: 's2', title: 'Stub', content_text: 'Too short', created_at: 2000 }),
      // Trashed duplicate ignored.
      makeRow({
        id: 't1',
        title: 'Unique',
        content_text: 'Only one live copy of this paragraph exists.',
        created_at: 1000,
      }),
      makeRow({
        id: 't2',
        title: 'Unique',
        content_text: 'Only one live copy of this paragraph exists.',
        created_at: 2000,
        deleted_at: 2500,
      }),
      // Databases ignored even if content_text were populated.
      makeRow({
        id: 'db1',
        kind: 'database',
        title: 'Table',
        content_text: 'Identical database text exceeding twenty characters.',
        created_at: 1000,
      }),
      makeRow({
        id: 'db2',
        kind: 'database',
        title: 'Table',
        content_text: 'Identical database text exceeding twenty characters.',
        created_at: 2000,
      }),
    ];

    const groups = findDuplicateGroups(rows);
    expect(groups).toHaveLength(2);

    // sameTitle: true sorts ahead of sameTitle: false.
    expect(groups[0].sameTitle).toBe(true);
    expect(groups[0].pages.map((p) => p.id)).toEqual(['p-old', 'p-new']);
    expect(groups[0].pages[0].parentPath).toEqual(['Research']);
    expect(groups[0].pages[1].parentPath).toEqual(['Research', '2026']);
    expect(groups[0].characters).toBe('photovoltaic panels convert sunlight into electricity.'.length);

    expect(groups[1].sameTitle).toBe(false);
    expect(groups[1].pages.map((p) => p.id)).toEqual(['d1', 'd2']);
    expect(groups[1].pages[0].parentPath).toEqual([]);
  });

  it('supports custom minChars and text/title extractors', () => {
    const rows = [
      makeRow({ id: 'a', title: 'Note', content_text: 'Short text!!', created_at: 1 }),
      makeRow({ id: 'b', title: 'Note', content_text: 'Short text!!', created_at: 2 }),
    ];
    expect(findDuplicateGroups(rows)).toHaveLength(0);
    expect(findDuplicateGroups(rows, { minChars: 10 })).toHaveLength(1);
  });

  it('rewrites internal link marks and pageMention nodes without mutating the source document', () => {
    const original: DocNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Read copy',
              marks: [{ type: 'link', attrs: { href: `${PAGE_LINK_PREFIX}dup-1` } }],
            },
            { type: 'text', text: ' and ' },
            { type: 'pageMention', attrs: { id: 'dup-2', label: 'Duplicate 2' } },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'external',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
      ],
    };
    const snapshot = JSON.stringify(original);
    const idMap = new Map([
      ['dup-1', 'kept-id'],
      ['dup-2', 'kept-id'],
    ]);

    const { doc, count } = rewriteDocPageLinks(original, idMap, 'Kept Page');
    expect(count).toBe(2);
    expect(JSON.stringify(original)).toBe(snapshot);

    const para = doc.content![0].content!;
    expect(para[0].marks![0].attrs?.href).toBe(`${PAGE_LINK_PREFIX}kept-id`);
    expect(para[2].attrs).toEqual({ id: 'kept-id', label: 'Kept Page' });
    expect(para[4].marks![0].attrs?.href).toBe('https://example.com');
  });
});

describe('duplicates repository helpers', () => {
  let s: Repos;
  let ws: string;

  beforeEach(async () => {
    s = await memoryStore();
    ws = (await s.workspaces.create('Duplicates')).id;
  });

  it('keeps the oldest page, recursively trashes extra copies (restorable) and redirects links', async () => {
    const folder = await s.pages.create({ workspaceId: ws, title: 'Archive' });
    const oldest = await s.pages.create({ workspaceId: ws, parentId: folder.id, title: 'Field Protocol' });
    const dup1 = await s.pages.create({ workspaceId: ws, title: 'Field Protocol' });
    const dup2 = await s.pages.create({ workspaceId: ws, title: 'Field Protocol Copy' });
    const dup1Sub = await s.pages.create({ workspaceId: ws, parentId: dup1.id, title: 'Nested Detail' });

    await s.db.run('UPDATE pages SET created_at = ? WHERE id = ?', [1000, oldest.id]);
    await s.db.run('UPDATE pages SET created_at = ? WHERE id = ?', [2000, dup1.id]);
    await s.db.run('UPDATE pages SET created_at = ? WHERE id = ?', [3000, dup2.id]);

    const body = 'Standardised field sampling procedure for coastal marshes.';
    await s.pages.saveContent(oldest.id, docFromParagraphs([body]));
    await s.pages.saveContent(dup1.id, docFromParagraphs(['Standardised field sampling   procedure for coastal marshes.']));
    await s.pages.saveContent(dup2.id, docFromParagraphs([body]));
    await s.pages.saveContent(dup1Sub.id, docFromParagraphs(['Child note under duplicate copy.']));

    // Live linking page referencing dup1 via a link mark and dup2 via a pageMention node.
    const hub = await s.pages.create({ workspaceId: ws, title: 'Research Hub' });
    await s.pages.saveContent(hub.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'text', text: 'protocol', marks: [{ type: 'link', attrs: { href: `${PAGE_LINK_PREFIX}${dup1.id}` } }] },
            { type: 'text', text: ' and ' },
            { type: 'pageMention', attrs: { id: dup2.id, label: 'Field Protocol Copy' } },
          ],
        },
      ],
    });

    const groups = await findWorkspaceDuplicates(s, ws);
    expect(groups).toHaveLength(1);
    expect(groups[0].pages.map((p) => p.id)).toEqual([oldest.id, dup1.id, dup2.id]);
    expect(groups[0].pages[0].parentPath).toEqual(['Archive']);
    expect(groups[0].pages[1].parentPath).toEqual([]);

    const affected = await findAffectedBacklinks(s, [dup1.id, dup2.id], oldest.id);
    expect(affected.map((p) => p.id)).toEqual([hub.id]);

    const res = await trashDuplicateCopies(s, oldest.id, [dup1.id, dup2.id]);
    expect(res).toMatchObject({
      keptId: oldest.id,
      trashedIds: [dup1.id, dup2.id],
      redirectedPages: 1,
      redirectedLinks: 2,
    });

    // Oldest kept live; extra copies and sub-page trashed recursively.
    expect((await s.pages.get(oldest.id))!.deleted_at).toBeNull();
    expect((await s.pages.get(dup1.id))!.deleted_at).not.toBeNull();
    expect((await s.pages.get(dup2.id))!.deleted_at).not.toBeNull();
    expect((await s.pages.get(dup1Sub.id))!.deleted_at).not.toBeNull();

    // Links in hub now point to oldest and backlinks reflect the redirect.
    const hubAfter = (await s.pages.get(hub.id))!;
    expect(hubAfter.content_json).toContain(`${PAGE_LINK_PREFIX}${oldest.id}`);
    expect(hubAfter.content_json).not.toContain(dup1.id);
    expect(hubAfter.content_json).not.toContain(dup2.id);
    expect((await s.pages.backlinks(oldest.id)).map((p) => p.id)).toEqual([hub.id]);
    expect(await s.pages.backlinks(dup1.id)).toEqual([]);

    // No duplicates remain.
    expect(await findWorkspaceDuplicates(s, ws)).toEqual([]);

    // Trashed copies remain restorable from Trash.
    await s.pages.restore(dup1.id);
    expect((await s.pages.get(dup1.id))!.deleted_at).toBeNull();
    expect((await s.pages.get(dup1Sub.id))!.deleted_at).toBeNull();
  });

  it('rescues the kept page if it is nested inside a trashed duplicate', async () => {
    const outerDup = await s.pages.create({ workspaceId: ws, title: 'Note' });
    const innerOldest = await s.pages.create({ workspaceId: ws, parentId: outerDup.id, title: 'Note' });
    await s.db.run('UPDATE pages SET created_at = ? WHERE id = ?', [1000, innerOldest.id]);
    await s.db.run('UPDATE pages SET created_at = ? WHERE id = ?', [2000, outerDup.id]);

    const body = 'Shared long content exceeding twenty characters for rescue test.';
    await s.pages.saveContent(outerDup.id, docFromParagraphs([body]));
    await s.pages.saveContent(innerOldest.id, docFromParagraphs([body]));

    await trashDuplicateCopies(s, innerOldest.id, [outerDup.id]);
    const kept = (await s.pages.get(innerOldest.id))!;
    const trashed = (await s.pages.get(outerDup.id))!;
    expect(kept.deleted_at).toBeNull();
    expect(kept.parent_id).toBeNull();
    expect(trashed.deleted_at).not.toBeNull();
  });
});
