// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { csvCell, exportWorkspace, relLink, safeName } from '../../src/export/exporter';
import { expandInputs, importWorkspace } from '../../src/import/importer';
import { packBinary, unpackBinary } from '../../src/lib/platform';
import { htmlToDoc } from '../../src/editor/serialize';
import { markdownToHtml } from '../../src/editor/markdown';
import { PAGE_LINK_PREFIX } from '../../src/core/doc';
import { sha256Hex } from '../../src/lib/util';
import { memoryBlobs, memoryStore } from '../helpers';
import { restoreNotebookNotes } from '../../src/import/notebook-notes';
import { createBackup, restoreBackup } from '../../src/core/backup';

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

describe('hardening', () => {
  it('neutralises spreadsheet formulas in CSV cells but keeps numbers', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('+3.5')).toBe('+3.5');
    expect(csvCell('plain, text')).toBe('"plain, text"');
  });

  it('refuses archives that unpack to too much data', async () => {
    const z = new JSZip();
    z.file('huge.md', new Uint8Array(301 * 1024 * 1024)); // compresses to almost nothing
    const bytes = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);
    await expect(expandInputs([{ path: 'bomb.zip', bytes }])).rejects.toThrow(/more data/);
  });

  it('round-trips binary IPC messages', () => {
    const { meta, payload } = unpackBinary<{ fileName: string }>(packBinary({ fileName: 'ş ğ.png' }, new Uint8Array([7, 8, 9])));
    expect(meta.fileName).toBe('ş ğ.png');
    expect(Array.from(payload)).toEqual([7, 8, 9]);
  });

  it('imports a hand-edited export with invalid task values without failing halfway', async () => {
    const z = new JSZip();
    z.file('Note.md', '# Note\n\n=1+1 is fine here');
    z.file('Noesis data/manifest.json', JSON.stringify({ format: 'noesis-export', version: 1, pages: [{ path: 'Note.md', title: 'Note', icon: 'x'.repeat(500) }] }));
    z.file('Noesis data/tasks.json', JSON.stringify([
      { ref: 'a', title: 'Bad values', priority: 99, status: 'exploded', recurrence: 'hourly', due_at: 'tomorrow' },
      { ref: 'b', parent: 'a', title: 'Child', priority: -4 },
      'not a task',
    ]));
    z.file('Noesis data/sources.json', '{ not json');
    const b = await memoryStore();
    const ws = (await b.workspaces.create('W')).id;
    const r = await importWorkspace(b, ws, [{ path: 'x.zip', bytes: await z.generateAsync({ type: 'uint8array' }) }], { blobs: memoryBlobs(), rootTitle: () => 'root' });
    expect(r).toMatchObject({ source: 'noesis', tasks: 2, sources: [] });
    const tasks = await b.tasks.list(ws);
    expect(tasks.find((t) => t.title === 'Bad values')).toMatchObject({ priority: 3, status: 'todo', recurrence: null, due_at: null });
    expect(tasks.find((t) => t.title === 'Child')!.priority).toBe(0);
    expect((await b.pages.listTree(ws)).find((p) => p.title === 'Note')!.icon).toBeNull();
  });
});

describe('export everything and import it back', () => {
  it('preserves Studio coverage in backups and notebook imports with new source identities', async () => {
    const a = await memoryStore();
    const ws = (await a.workspaces.create('Study')).id;
    const source = await a.sources.create({ workspaceId: ws, title: 'Report', kind: 'note', origin: 'pasted' });
    await a.sources.setExtracted(source.id, 'The project recovered 731 artefacts.', null, {});
    const nb = await a.notebooks.create(ws, 'Research');
    await a.notebooks.addSource(nb.id, source.id);
    const data = { coverage: [{ sourceId: source.id, sourceTitle: 'Report', totalChars: 200000, representedChars: 200000, condensed: true, parts: 5, totalParts: 5, summaryClipped: false }] };
    await a.notebooks.addNote(nb.id, 'summary', 'Findings', '731 artefacts [1].', data, [{ n: 1, sourceId: source.id, sourceTitle: 'Report', chunkId: -1, pageNumber: null, charStart: 0, charEnd: 0, excerpt: '' }]);
    const backup = await createBackup(a.db, memoryBlobs());
    const restored = await memoryStore();
    await restoreBackup(restored.db, backup, memoryBlobs());
    expect((await restored.notebooks.notes(nb.id))[0].data).toEqual(data);

    const exported = await exportWorkspace(a, ws, memoryBlobs());
    const b = await memoryStore();
    const target = (await b.workspaces.create('Imported')).id;
    const imported = await importWorkspace(b, target, [{ path: 'study.zip', bytes: exported.bytes }], { blobs: memoryBlobs(), rootTitle: () => 'Imported' });
    const newSource = await b.sources.create({ workspaceId: target, title: 'Report', kind: 'note', origin: 'pasted' });
    expect(imported.sources[0].ref).toBe(source.id);
    await restoreNotebookNotes(b, target, imported.notebooks, new Map([[source.id, newSource.id]]));
    const newNb = (await b.notebooks.list(target))[0];
    const newNote = (await b.notebooks.notes(newNb.id))[0];
    expect(newNote.data.coverage).toEqual([{ ...data.coverage[0], sourceId: newSource.id }]);
    expect(newNote.citations[0].sourceId).toBe(newSource.id);
    expect((await b.notebooks.sources(newNb.id))[0].id).toBe(newSource.id);
  });

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
