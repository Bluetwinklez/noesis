import { describe, expect, it, vi } from 'vitest';
import { memoryBlobs, memoryStore } from '../helpers';
import { createBackup } from '../../src/core/backup';
import { NodeDriver } from '../../src/core/db/node-driver';
import { stageRecovery } from '../../src/app/recovery';

describe('independent backup recovery', () => {
  it('rejects an invalid backup before creating a replacement database or writing files', async () => {
    const create = vi.fn();
    const blobs = { get: vi.fn(), put: vi.fn() };
    await expect(stageRecovery(new TextEncoder().encode('invalid backup'), create, blobs)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(blobs.put).not.toHaveBeenCalled();
  });
  it('reconstructs a verified backup in a separate database and closes it after export', async () => {
    const source = await memoryStore();
    const ws = await source.workspaces.create('Recovery');
    await source.pages.create({ workspaceId: ws.id, title: 'Retained page' });
    const bytes = await createBackup(source.db, memoryBlobs());
    const staged = new NodeDriver();
    const close = vi.spyOn(staged, 'close');
    const exportBytes = vi.fn(async () => {
      const result = await staged.exec('SELECT title FROM pages');
      expect(result.rows[0].title).toBe('Retained page');
      return new Uint8Array([1, 2, 3]);
    });
    expect(await stageRecovery(bytes, async () => Object.assign(staged, { exportBytes }), memoryBlobs())).toEqual(new Uint8Array([1, 2, 3]));
    expect(close).toHaveBeenCalledOnce();
    await source.db.flushNow(); await source.db.driver.close?.();
  });
  it('closes staging after a reconstruction failure and never exports it', async () => {
    const source = await memoryStore();
    await source.workspaces.create('Recovery');
    const bytes = await createBackup(source.db, memoryBlobs());
    const driver = { kind: 'node' as const, exec: vi.fn().mockRejectedValue(new Error('Staging unavailable')), close: vi.fn(), exportBytes: vi.fn() };
    await expect(stageRecovery(bytes, async () => driver, memoryBlobs())).rejects.toThrow('Staging unavailable');
    expect(driver.close).toHaveBeenCalledOnce();
    expect(driver.exportBytes).not.toHaveBeenCalled();
    await source.db.flushNow(); await source.db.driver.close?.();
  });
});
