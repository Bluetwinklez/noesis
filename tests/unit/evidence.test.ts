import { describe, expect, it } from 'vitest';
import { memoryBlobs, memoryStore } from '../helpers';
import { createBackup, restoreBackup } from '../../src/core/backup';
import { Database } from '../../src/core/db/driver';
import { NodeDriver } from '../../src/core/db/node-driver';
import { migrate, migrations } from '../../src/core/db/migrations';
import { NotebookRepo } from '../../src/core/repos/research';
import { uncitedSentenceRanges } from '../../src/ai/evidence';
import JSZip from 'jszip';

describe('persisted answer evidence', () => {
  it('stores an insufficient-evidence flag and keeps it through backup/restore', async () => {
    const s = await memoryStore();
    const ws = await s.workspaces.create('Evidence');
    const nb = await s.notebooks.create(ws.id, 'Research');
    const message = { notebook_id: nb.id, role: 'assistant' as const, content: 'A model answer without citations.', citations: [], status: 'complete' as const, insufficient: true };
    await s.notebooks.addMessage(message);
    expect((await s.notebooks.messages(nb.id))[0]).toMatchObject({ insufficient: true });
    const backup = await createBackup(s.db, memoryBlobs());
    const target = await memoryStore();
    await restoreBackup(target.db, backup, memoryBlobs());
    expect((await target.notebooks.messages(nb.id))[0]).toMatchObject({ insufficient: true });
  });

  it('migrates v4 answers without citations without changing user messages', async () => {
    const db = new Database(new NodeDriver());
    await migrate(db, migrations.slice(0, 4));
    await db.run("INSERT INTO workspaces(id,name,created_at,updated_at) VALUES ('w','W',0,0)");
    const repo = new NotebookRepo(db);
    const nb = await repo.create('w', 'Legacy');
    await db.run("INSERT INTO chat_messages(id,notebook_id,role,content,created_at) VALUES ('a',?,'assistant','Uncited claim.',0)", [nb.id]);
    await db.run("INSERT INTO chat_messages(id,notebook_id,role,content,created_at) VALUES ('u',?,'user','Question?',1)", [nb.id]);
    // A historical v4 backup has no insufficient column. Its schema version must
    // remain v4 even though this test uses the current backup writer.
    const oldZip = await JSZip.loadAsync(await createBackup(db, memoryBlobs()));
    const oldManifest = JSON.parse(await oldZip.file('manifest.json')!.async('string'));
    oldManifest.schemaVersion = 4;
    oldZip.file('manifest.json', JSON.stringify(oldManifest));
    const target = await memoryStore();
    await restoreBackup(target.db, await oldZip.generateAsync({ type: 'uint8array' }), memoryBlobs());
    expect((await target.notebooks.messages(nb.id))[0]).toMatchObject({ insufficient: true });
    await migrate(db);
    const messages = await repo.messages(nb.id);
    expect(messages[0]).toMatchObject({ insufficient: true });
    expect(messages[1]).toMatchObject({ insufficient: false });
  });
});

describe('sentence citation presence', () => {
  it('marks the uncited sentence while accepting references after punctuation', () => {
    const text = 'RuBisCO fixes carbon. [1] An unsupported claim follows.';
    const ranges = uncitedSentenceRanges(text, new Set([1]));
    expect(ranges.map((r) => text.slice(r.start, r.end).trim())).toEqual(['An unsupported claim follows.']);
  });
  it('does not count invented references and supports Turkish sentences', () => {
    const text = 'Bu iddia desteklenmiyor [9]. İkinci iddia destekli [1].';
    const ranges = uncitedSentenceRanges(text, new Set([1]), 'tr');
    expect(ranges.map((r) => text.slice(r.start, r.end).trim())).toEqual(['Bu iddia desteklenmiyor [9].']);
  });
  it('handles decimals and internal citation placeholders', () => {
    const text = 'The sample weighs 1.5 kg. @@NOESIS_CITE1@@';
    expect(uncitedSentenceRanges(text, new Set([1]))).toEqual([]);
    expect(uncitedSentenceRanges('42. [1]', new Set([1]))).toEqual([]);
  });
});
