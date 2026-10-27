// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { exportWorkspace, relLink, safeName } from '../../src/export/exporter';
import { importWorkspace } from '../../src/import/importer';
import { htmlToDoc } from '../../src/editor/serialize';
import { markdownToHtml } from '../../src/editor/markdown';
import { PAGE_LINK_PREFIX } from '../../src/core/doc';
import { sha256Hex } from '../../src/lib/util';
import { memoryBlobs, memoryStore } from '../helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);

describe('file names and links', () => {
  it('makes Windows-safe names and relative links', () => {
    expect(safeName('a/b: c?')).toBe('a b c');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('  ...  ')).toBe('Untitled');
    expect(relLink('A/B', 'A/C/x y.md')).toBe('../C/x%20y.md');
    expect(relLink('', 'Notes (2).md')).toBe('Notes%20%282%29.md');
  });
});

describe('export everything and import it back', () => {
  it('round-trips pages, links, images, databases, tasks and sources', async () => {
    const a = await memoryStore();
    const blobsA = memoryBlobs();
    const ws = (await a.workspaces.create('Thesis')).id;

    // Image attachment, nested pages with a link and tags, odd characters in titles.
    const key = await blobsA.put('figure.png', PNG);
    const att = await a.attachments.create({ workspace_id: ws, file_name: 'figure.png', mime: 'image/png', size: PNG.length, storage_key: key, sha256: await sha256Hex(PNG) });
    const project = await a.pages.create({ workspaceId: ws, title: 'Project: Alpha?', icon: '🚀' });
    const child = await a.pages.create({ workspaceId: ws, parentId: project.id, title: 'Meeting notes' });
    const dup = await a.pages.create({ workspaceId: ws, parentId: project.id, title: 'Meeting notes' });
    await a.pages.saveContent(project.id, htmlToDoc(markdownToHtml(`Intro **bold**.\n\nSee [the notes](${PAGE_LINK_PREFIX}${child.id}).\n\n![fig](attachment:${att.id})\n`)));
    await a.pages.saveContent(child.id, htmlToDoc(markdownToHtml('- [ ] Send minutes\n- [x] Book room\n')));
    await a.pages.saveContent(dup.id, htmlToDoc(markdownToHtml('Second copy')));
    await a.pages.addTag(project.id, 'research');
    const trashed = await a.pages.create({ workspaceId: ws, title: 'Old draft' });
    await a.pages.trash(trashed.id);

    // Database with status, number, date and checkbox.
    const db = await a.databases.createDatabase(ws, 'Reading list', project.id);
    const props = await a.databases.properties(db.id);
    const title = props.find((p) => p.type === 'title')!;
    const status = props.find((p) => p.type === 'status')!;
    const pages = await a.databases.addProperty(db.id, 'Pages', 'number');
    const due = await a.databases.addProperty(db.id, 'Due', 'date');
    const read = await a.databases.addProperty(db.id, 'Read', 'checkbox');
    await a.databases.addRow(db.id, { [title.id]: 'Kuhn, "Structure"', [status.id]: 'done', [pages.id]: 264, [due.id]: '2026-11-03', [read.id]: true });
    await a.databases.addRow(db.id, { [title.id]: 'Kahneman', [status.id]: 'in_progress', [pages.id]: 499, [read.id]: false });

    // Tasks with a subtask and a project link; sources (text + URL).
    const parent = await a.tasks.create({ workspaceId: ws, title: 'Write chapter 1', projectPageId: project.id, priority: 3, dueAt: Date.UTC(2026, 10, 5) });
    await a.tasks.create({ workspaceId: ws, title: 'Collect quotes', parentId: parent.id });
    const note = await a.sources.create({ workspaceId: ws, title: 'Interview notes', kind: 'note', origin: 'pasted' });
    await a.sources.setExtracted(note.id, 'Bees decide by quorum.', null, {});
    await a.sources.create({ workspaceId: ws, title: 'Article', kind: 'url', origin: 'https://example.com/bees' });

    const { bytes, manifest } = await exportWorkspace(a, ws, blobsA, { appVersion: '0.1.4' });
    expect(manifest.counts).toMatchObject({ pages: 3, databases: 1, files: 1, tasks: 2, sources: 2 });

    // The archive is readable on its own.
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names).toEqual(expect.arrayContaining(['Project Alpha.md', 'Project Alpha/Meeting notes.md', 'Project Alpha/Meeting notes (2).md', 'Project Alpha/Reading list.csv', 'Noesis data/attachments/figure.png', 'Noesis data/Tasks.md']));
    expect(names.some((n) => n.includes('Old draft'))).toBe(false);
    const md = await zip.file('Project Alpha.md')!.async('string');
    expect(md).toContain('tags: ["research"]');
    expect(md).toContain('](Project%20Alpha/Meeting%20notes.md)');
    expect(md).toContain('](Noesis%20data/attachments/figure.png)');
    const csv = await zip.file('Project Alpha/Reading list.csv')!.async('string');
    expect(csv).toContain('"Kuhn, ""Structure"""');
    expect(csv).toContain('Done,264,2026-11-03,Yes');

    // Import into another computer's (empty) workspace.
    const b = await memoryStore();
    const ws2 = (await b.workspaces.create('Laptop')).id;
    const r = await importWorkspace(b, ws2, [{ path: 'Noesis Thesis 2026-10-27.zip', bytes }], { blobs: memoryBlobs(), rootTitle: (src) => `root:${src}` });
    expect(r).toMatchObject({ source: 'noesis', pages: 3, databases: 1, images: 1, tasks: 2, skipped: [] });

    const tree = await b.pages.listTree(ws2);
    const byTitle = (t: string) => tree.filter((p) => p.title === t);
    const p2 = byTitle('Project: Alpha?')[0];
    expect(p2).toMatchObject({ icon: '🚀' });
    expect(byTitle('Meeting notes')).toHaveLength(2);
    expect(byTitle('Meeting notes').every((p) => p.parent_id === p2.id)).toBe(true);
    const full = (await b.pages.get(p2.id))!;
    expect(full.content_text).toContain('Intro bold');
    expect(full.content_json).toContain(PAGE_LINK_PREFIX);
    expect(full.content_json).toContain('attachment:');
    expect(full.content_json).not.toContain('Project%20Alpha');
    expect((await b.pages.pageTags(p2.id)).map((t) => t.name)).toEqual(['research']);
    // The link still points at the first "Meeting notes" (the checklist), not its namesake.
    const linked = full.content_json!.match(/noesis:\/\/page\/([\w-]+)/)![1];
    expect((await b.pages.get(linked))!.content_json).toContain('taskItem');

    const db2 = byTitle('Reading list')[0];
    const props2 = await b.databases.properties(db2.id);
    expect(props2.map((p) => `${p.name}:${p.type}`)).toEqual(['Name:title', 'Status:status', 'Pages:number', 'Due:date', 'Read:checkbox']);
    const rows2 = await b.databases.rows(db2.id);
    const st = props2.find((p) => p.type === 'status')!;
    expect(rows2.map((row) => st.options.options!.find((o) => o.id === row.values[st.id])?.name)).toEqual(['Done', 'In progress']);
    expect(rows2[0].values[props2[0].id]).toBe('Kuhn, "Structure"');

    const tasks2 = await b.tasks.list(ws2);
    const parent2 = tasks2.find((t) => t.title === 'Write chapter 1')!;
    expect(parent2).toMatchObject({ priority: 3, due_at: Date.UTC(2026, 10, 5), project_page_id: p2.id });
    expect(tasks2.find((t) => t.title === 'Collect quotes')!.parent_id).toBe(parent2.id);

    // Same-millisecond sources have no defined order, so compare them sorted by title.
    expect(r.sources.map((x) => [x.title, x.kind, x.text, x.file]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      ['Article', 'url', null, null],
      ['Interview notes', 'note', 'Bees decide by quorum.', null],
    ]);
  });
});
