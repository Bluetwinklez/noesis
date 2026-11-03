import { describe, expect, it } from 'vitest';
import { docFromParagraphs } from '../../src/core/doc';
import { ensureDailyNote, formatDailyTitle, localDayKey, monthGrid } from '../../src/features/daily-notes/daily';
import { memoryBlobs, memoryStore } from '../helpers';
import { exportWorkspace } from '../../src/export/exporter';
import { importWorkspace } from '../../src/import/importer';
import { createBackup, restoreBackup } from '../../src/core/backup';

describe('daily notes', () => {
  it('formats local dates without UTC day drift', () => {
    const date = new Date(2026, 10, 2, 23, 45);
    expect(localDayKey(date)).toBe('2026-11-02');
    expect(formatDailyTitle(date, 'iso', 'en')).toBe('2026-11-02');
    expect(formatDailyTitle(date, 'short', 'en')).toContain('2026');
    expect(formatDailyTitle(date, 'long', 'tr')).toContain('2026');
  });

  it('aligns month grids to the selected first weekday', () => {
    expect(monthGrid(2026, 10, 1).slice(0, 7).map((date) => date?.getDate() ?? null)).toEqual([null, null, null, null, null, null, 1]);
    expect(monthGrid(2026, 10, 0)[0]?.getDate()).toBe(1);
  });

  it('creates one dated child under Daily notes and copies the selected template', async () => {
    const repos = await memoryStore();
    const workspace = await repos.workspaces.create('Daily test');
    const template = await repos.pages.create({ workspaceId: workspace.id, title: 'Journal template', isTemplate: true, content: docFromParagraphs(['Prompt']) });
    const date = new Date(2026, 10, 2, 12);
    const first = await ensureDailyNote(repos, workspace.id, date, { format: 'iso', lang: 'en', templateId: template.id });
    const second = await ensureDailyNote(repos, workspace.id, date, { format: 'iso', lang: 'en', templateId: template.id });
    expect(second.id).toBe(first.id);
    expect(first.title).toBe('2026-11-02');
    expect(first.content_text).toBe('Prompt');
    const parent = await repos.pages.get(first.parent_id!);
    expect(parent?.title).toBe('Daily notes');
  });

  it('reopens the same day after changing language and format, including simultaneous requests', async () => {
    const repos = await memoryStore();
    const workspace = await repos.workspaces.create('Daily identity');
    const date = new Date(2026, 10, 2, 12);
    const [first, second] = await Promise.all([
      ensureDailyNote(repos, workspace.id, date, { format: 'short', lang: 'en' }),
      ensureDailyNote(repos, workspace.id, date, { format: 'long', lang: 'tr' }),
    ]);
    expect(second.id).toBe(first.id);
    const third = await ensureDailyNote(repos, workspace.id, date, { format: 'iso', lang: 'tr' });
    expect(third.id).toBe(first.id);
  });

  it('retains the day identity when the note is renamed', async () => {
    const repos = await memoryStore();
    const workspace = await repos.workspaces.create('Renamed daily note');
    const date = new Date(2026, 10, 2, 12);
    const first = await ensureDailyNote(repos, workspace.id, date, { format: 'iso', lang: 'en' });
    await repos.pages.updateMeta(first.id, { title: 'My renamed journal' });
    const reopened = await ensureDailyNote(repos, workspace.id, date, { format: 'short', lang: 'tr' });
    expect(reopened.id).toBe(first.id);
  });

  it('preserves the day mapping in workspace exports and backups', async () => {
    const repos = await memoryStore();
    const workspace = await repos.workspaces.create('Transfer');
    const date = new Date(2026, 10, 2, 12);
    const page = await ensureDailyNote(repos, workspace.id, date, { format: 'iso', lang: 'en' });
    await repos.pages.updateMeta(page.id, { title: 'Renamed' });
    const blobs = memoryBlobs();
    const exported = await exportWorkspace(repos, workspace.id, blobs);
    const target = await memoryStore();
    const targetWorkspace = await target.workspaces.create('Target');
    await importWorkspace(target, targetWorkspace.id, [{ path: 'export.zip', bytes: exported.bytes }], { blobs: memoryBlobs(), rootTitle: () => 'Import' });
    const imported = await ensureDailyNote(target, targetWorkspace.id, date, { format: 'long', lang: 'tr' });
    expect(imported.title).toBe('Renamed');
    const backup = await createBackup(repos.db, blobs);
    const restored = await memoryStore();
    await restoreBackup(restored.db, backup, memoryBlobs());
    expect((await ensureDailyNote(restored, workspace.id, date, { format: 'short', lang: 'en' })).id).toBe(page.id);
  });
});
