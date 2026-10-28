import { describe, expect, it } from 'vitest';
import { autoBackupDue, purgeOldTrash } from '../../src/app/maintenance';
import { memoryStore } from '../helpers';

const DAY = 86_400_000;

describe('maintenance', () => {
  it('empties only trash older than the chosen number of days', async () => {
    const s = await memoryStore();
    const ws = (await s.workspaces.create('W')).id;
    const old = await s.pages.create({ workspaceId: ws, title: 'Old' });
    const child = await s.pages.create({ workspaceId: ws, parentId: old.id, title: 'Old child' });
    const recent = await s.pages.create({ workspaceId: ws, title: 'Recent' });
    const kept = await s.pages.create({ workspaceId: ws, title: 'Not trashed' });
    await s.pages.trash(old.id);
    await s.pages.trash(recent.id);
    const now = Date.now() + 31 * DAY;
    await s.db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [now - DAY, recent.id]);

    expect(await purgeOldTrash(s, 0, now)).toBe(0); // "never"
    expect(await purgeOldTrash(s, 30, now)).toBe(1);
    expect(await s.pages.get(old.id)).toBeFalsy();
    expect(await s.pages.get(child.id)).toBeFalsy();
    expect(await s.pages.get(recent.id)).toBeTruthy();
    expect(await s.pages.get(kept.id)).toBeTruthy();
  });

  it('knows when an automatic backup is due', () => {
    const now = Date.now();
    expect(autoBackupDue({ autoBackup: 'off', lastAutoBackupAt: null }, now)).toBe(false);
    expect(autoBackupDue({ autoBackup: 'daily', lastAutoBackupAt: null }, now)).toBe(true);
    expect(autoBackupDue({ autoBackup: 'daily', lastAutoBackupAt: now - DAY / 2 }, now)).toBe(false);
    expect(autoBackupDue({ autoBackup: 'daily', lastAutoBackupAt: now - DAY }, now)).toBe(true);
    expect(autoBackupDue({ autoBackup: 'weekly', lastAutoBackupAt: now - 3 * DAY }, now)).toBe(false);
    expect(autoBackupDue({ autoBackup: 'weekly', lastAutoBackupAt: now - 8 * DAY }, now)).toBe(true);
  });
});
