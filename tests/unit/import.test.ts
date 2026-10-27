// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { Repos } from '../../src/core/store';
import { importWorkspace } from '../../src/import/importer';
import { markdownToHtml } from '../../src/editor/markdown';
import { memoryBlobs, memoryStore } from '../helpers';

const enc = new TextEncoder();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let s: Repos;
let ws: string;
let blobs: ReturnType<typeof memoryBlobs>;

async function zip(files: Record<string, string | Uint8Array>) {
  const z = new JSZip();
  for (const [p, v] of Object.entries(files)) z.file(p, typeof v === 'string' ? enc.encode(v) : v);
  return { path: 'export.zip', bytes: await z.generateAsync({ type: 'uint8array' }) };
}

const docText = async (id: string) => (await s.pages.get(id))!.content_text;
const json = async (id: string) => (await s.pages.get(id))!.content_json ?? '';
const childrenOf = async (parent: string) => (await s.pages.listTree(ws)).filter((p) => p.parent_id === parent);

beforeEach(async () => {
  s = await memoryStore();
  ws = (await s.workspaces.create('Import')).id;
  blobs = memoryBlobs();
});

describe('Notion import', () => {
  it('rebuilds the page tree, links, images and databases', async () => {
    const id1 = '0123456789abcdef0123456789abcdef';
    const id2 = 'fedcba9876543210fedcba9876543210';
    const id3 = 'aaaabbbbccccddddeeeeffff00001111';
    const file = await zip({
      [`Export-x/Project Alpha ${id1}.md`]: `# Project Alpha\n\nSee [Meeting notes](Project%20Alpha%20${id1}/Meeting%20notes%20${id2}.md).\n\n![diagram](Project%20Alpha%20${id1}/diagram.png)\n`,
      [`Export-x/Project Alpha ${id1}/Meeting notes ${id2}.md`]: '# Meeting notes\n\n- [ ] Send minutes\n- [x] Book room\n',
      [`Export-x/Project Alpha ${id1}/diagram.png`]: PNG,
      [`Export-x/Project Alpha ${id1}/Tasks ${id3}.csv`]: 'Name,Done,Estimate,Link\nWrite spec,Yes,3,https://example.com\nReview,No,1.5,\n',
      [`Export-x/Project Alpha ${id1}/Tasks ${id3}_all.csv`]: 'ignored',
    });
    const r = await importWorkspace(s, ws, [file], { blobs, rootTitle: (src) => `Imported from ${src}` });
    expect(r).toMatchObject({ source: 'notion', pages: 2, databases: 1, images: 1 });

    const [alpha] = await childrenOf(r.rootId);
    expect(alpha.title).toBe('Project Alpha'); // Notion id suffix removed, shared top folder skipped
    const kids = await childrenOf(alpha.id);
    expect(kids.map((k) => k.title).sort()).toEqual(['Meeting notes', 'Tasks']);
    const meeting = kids.find((k) => k.title === 'Meeting notes')!;

    expect(await docText(alpha.id)).not.toMatch(/^Project Alpha/); // duplicate H1 removed
    expect(await json(alpha.id)).toContain(`noesis://page/${meeting.id}`); // link rewritten
    expect(await json(alpha.id)).toMatch(/attachment:[0-9a-f-]{36}/); // image stored
    expect(await json(meeting.id)).toContain('taskList');
    expect((await s.pages.backlinks(meeting.id)).map((b) => b.id)).toContain(alpha.id);

    const db = kids.find((k) => k.title === 'Tasks')!;
    const props = await s.databases.properties(db.id);
    expect(props.map((p) => [p.name, p.type])).toEqual([
      ['Name', 'title'],
      ['Done', 'checkbox'],
      ['Estimate', 'number'],
      ['Link', 'url'],
    ]);
    const rows = await s.databases.rows(db.id);
    expect(rows).toHaveLength(2);
    const est = props.find((p) => p.name === 'Estimate')!;
    expect(rows.map((row) => row.values[est.id]).sort()).toEqual([1.5, 3]);
  });

  it('reports archives without notes clearly', async () => {
    await expect(importWorkspace(s, ws, [await zip({ 'a.txt': 'x' })], { blobs, rootTitle: () => 'X' })).rejects.toThrow(/No Markdown/);
  });
});

describe('Obsidian import', () => {
  it('turns folders, wikilinks, embeds and front-matter tags into Noesis pages', async () => {
    const file = await zip({
      'Vault/Daily/2026-10-27.md': '---\ntags: [journal, ideas]\n---\nMet with [[People/Ada|Ada]] about [[Roadmap#Q4]].\n\n![[sketch.png]]\n',
      'Vault/People/Ada.md': 'Ada works on [[Roadmap]].',
      'Vault/Roadmap.md': '## Q4\n\nShip the importer.',
      'Vault/attachments/sketch.png': PNG,
      'Vault/.obsidian/workspace.json': '{}',
    });
    const r = await importWorkspace(s, ws, [file], { blobs, rootTitle: (src) => `Imported from ${src}` });
    expect(r).toMatchObject({ source: 'obsidian', pages: 3, images: 1 });
    const tree = await s.pages.listTree(ws);
    const byTitle = (t: string) => tree.find((p) => p.title === t)!;
    expect(byTitle('Daily').parent_id).toBe(r.rootId); // folder page
    expect(byTitle('Ada').parent_id).toBe(byTitle('People').id);
    const daily = await json(byTitle('2026-10-27').id);
    expect(daily).toContain(`noesis://page/${byTitle('Ada').id}`);
    expect(daily).toContain(`noesis://page/${byTitle('Roadmap').id}`);
    expect(daily).toMatch(/attachment:/);
    expect(await docText(byTitle('2026-10-27').id)).not.toContain('tags:');
    expect((await s.pages.pageTags(byTitle('2026-10-27').id)).map((t) => t.name).sort()).toEqual(['ideas', 'journal']);
    expect(tree.some((p) => p.title === 'workspace')).toBe(false); // .obsidian ignored
  });
});

describe('markdown sanitising', () => {
  it('keeps internal links and images but still strips script URLs', () => {
    const html = markdownToHtml('[p](noesis://page/abc) ![i](attachment:xyz) [x](javascript:alert(1))');
    expect(html).toContain('href="noesis://page/abc"');
    expect(html).toContain('src="attachment:xyz"');
    expect(html).not.toContain('javascript:');
  });
});
