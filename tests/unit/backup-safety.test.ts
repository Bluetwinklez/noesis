import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createBackup, inspectBackup, restoreBackup } from '../../src/core/backup';
import { memoryBlobs, memoryStore } from '../helpers';

describe('backup safety', () => {
  async function archiveWithAttachment() {
    const s = await memoryStore();
    const ws = await s.workspaces.create('Research');
    const blobs = memoryBlobs();
    const key = await blobs.put('notes.txt', new TextEncoder().encode('source text'));
    await s.attachments.create({ workspace_id: ws.id, file_name: 'notes.txt', mime: 'text/plain', size: 11, storage_key: key, sha256: null });
    return { s, blobs, key };
  }

  it('refuses to create a backup when a referenced attachment is unavailable', async () => {
    const { s, blobs, key } = await archiveWithAttachment();
    await expect(createBackup(s.db, null)).rejects.toThrow(/storage is required/);
    blobs.map.delete(key);
    await expect(createBackup(s.db, blobs)).rejects.toThrow(/incomplete archive/);
  });

  it('validates attachment presence and bytes before modifying live data', async () => {
    const { s, blobs, key } = await archiveWithAttachment();
    const backup = await createBackup(s.db, blobs);
    const zip = await JSZip.loadAsync(backup);
    zip.remove(`attachments/${encodeURIComponent(key)}`);
    const broken = await zip.generateAsync({ type: 'uint8array' });
    const target = await memoryStore();
    await target.workspaces.create('Keep my notes');
    await expect(restoreBackup(target.db, broken, memoryBlobs())).rejects.toThrow(/missing/);
    expect((await target.workspaces.list())[0].name).toBe('Keep my notes');
    expect((await target.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys).toBe(1);
  });

  it('rejects attachment checksum mismatches during inspection', async () => {
    const { s, blobs, key } = await archiveWithAttachment();
    const zip = await JSZip.loadAsync(await createBackup(s.db, blobs));
    zip.file(`attachments/${encodeURIComponent(key)}`, 'altered');
    await expect(inspectBackup(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/verification/);
  });

  it('rejects future formats and missing table manifests', async () => {
    const s = await memoryStore();
    await s.workspaces.create('Keep');
    for (const invalid of [{ formatVersion: 2 }, { tables: {} }, { attachments: null }]) {
      const zip = await JSZip.loadAsync(await createBackup(s.db, null));
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
      zip.file('manifest.json', JSON.stringify({ ...manifest, ...invalid }));
      await expect(inspectBackup(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow();
    }
  });

  it('restores a nested hierarchy with foreign key enforcement left enabled', async () => {
    const s = await memoryStore();
    const ws = await s.workspaces.create('Nested');
    const parent = await s.pages.create({ workspaceId: ws.id, title: 'Parent' });
    await s.pages.create({ workspaceId: ws.id, parentId: parent.id, title: 'Child' });
    const backup = await createBackup(s.db, null);
    await s.pages.create({ workspaceId: ws.id, title: 'Remove on restore' });
    await restoreBackup(s.db, backup, null);
    expect(await s.db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect((await s.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys).toBe(1);
    expect((await s.db.all('SELECT * FROM pages')).length).toBe(2);
  });
});
