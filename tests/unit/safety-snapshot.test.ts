// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_BACKUP_PREFIX,
  BEFORE_AI_BACKUP_KEEP,
  BEFORE_AI_BACKUP_LABEL,
  BEFORE_AI_BACKUP_PREFIX,
  createMemoryBackupStore,
  listSavedBackups,
  pruneBackupList,
  readSavedBackup,
  runBeforeAiBackup,
} from '../../src/app/maintenance';
import { inspectBackup, restoreBackup } from '../../src/core/backup';
import { docFromParagraphs } from '../../src/core/doc';
import { DEFAULT_PREFS, useApp } from '../../src/app/state';
import { loadSettings } from '../../src/app/services';
import { SAFETY_SNAPSHOT_WINDOW_MS, SafetySnapshotThrottle } from '../../src/mcp/safety-snapshot';
import { memoryBlobs, memoryStore } from '../helpers';

const MINUTE = 60_000;

describe('SafetySnapshotThrottle', () => {
  it('triggers on the first call, skips within the 30-minute window, triggers for a new client, and triggers again after expiry', async () => {
    let now = 1_700_000_000_000;
    const calls: string[] = [];
    const throttle = new SafetySnapshotThrottle({
      now: () => now,
      takeSnapshot: async (client) => {
        calls.push(client);
      },
    });

    // First call triggers.
    expect(await throttle.maybeSnapshot('Claude')).toBe(true);
    expect(calls).toEqual(['Claude']);

    // Second call within window does not trigger.
    now += 10 * MINUTE;
    expect(await throttle.maybeSnapshot('Claude')).toBe(false);
    now += SAFETY_SNAPSHOT_WINDOW_MS - 10 * MINUTE - 1;
    expect(await throttle.maybeSnapshot('Claude')).toBe(false);
    expect(calls).toEqual(['Claude']);

    // Different client within Claude's window DOES trigger.
    expect(await throttle.maybeSnapshot('Cursor')).toBe(true);
    expect(calls).toEqual(['Claude', 'Cursor']);
    expect(await throttle.maybeSnapshot('Cursor')).toBe(false);

    // Reaching exact window expiry for Claude triggers again.
    now += 1;
    expect(await throttle.maybeSnapshot('Claude')).toBe(true);
    expect(calls).toEqual(['Claude', 'Cursor', 'Claude']);

    // And starts a fresh 30-minute window for Claude.
    now += 5 * MINUTE;
    expect(await throttle.maybeSnapshot('Claude')).toBe(false);
    expect(calls).toEqual(['Claude', 'Cursor', 'Claude']);
  });

  it('never triggers when the preference is disabled and triggers once re-enabled', async () => {
    let now = 1_700_000_000_000;
    let enabled = false;
    const takeSnapshot = vi.fn(async () => {});
    const throttle = new SafetySnapshotThrottle({
      now: () => now,
      isEnabled: () => enabled,
      takeSnapshot,
    });

    expect(await throttle.maybeSnapshot('Claude')).toBe(false);
    now += 60 * MINUTE;
    expect(await throttle.maybeSnapshot('Claude')).toBe(false);
    expect(takeSnapshot).not.toHaveBeenCalled();

    // Turning the setting back on takes a snapshot on the very next call.
    enabled = true;
    expect(await throttle.maybeSnapshot('Claude')).toBe(true);
    expect(takeSnapshot).toHaveBeenCalledTimes(1);
    expect(takeSnapshot).toHaveBeenCalledWith('Claude');
  });

  it('does not record a cooldown timestamp when taking the snapshot fails, and coalesces concurrent calls', async () => {
    let failNext = true;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const throttle = new SafetySnapshotThrottle({
      now: () => 1_700_000_000_000,
      takeSnapshot: async () => {
        calls++;
        if (failNext) {
          failNext = false;
          throw new Error('disk full');
        }
        await gate;
      },
    });

    await expect(throttle.maybeSnapshot('Claude')).rejects.toThrow('disk full');
    expect(calls).toBe(1);

    // Next attempt is not throttled because the failed snapshot did not record a timestamp.
    const first = throttle.maybeSnapshot('Claude');
    const second = throttle.maybeSnapshot('Claude');
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(calls).toBe(2);
  });
});

describe('before AI changes safety backup retention and restore', () => {
  it('prunes only the target prefix to the newest N while preserving other backups', () => {
    const entries = [
      { name: `${BEFORE_AI_BACKUP_PREFIX}20261101-100000.noesisbak` },
      { name: `${BEFORE_AI_BACKUP_PREFIX}20261102-100000.noesisbak` },
      { name: `${BEFORE_AI_BACKUP_PREFIX}20261103-100000.noesisbak` },
      { name: `${BEFORE_AI_BACKUP_PREFIX}20261104-100000.noesisbak` },
      { name: `${BEFORE_AI_BACKUP_PREFIX}20261105-100000.noesisbak` },
      { name: `${BEFORE_AI_BACKUP_PREFIX}20261106-100000.noesisbak` },
      { name: `${BEFORE_AI_BACKUP_PREFIX}20261107-100000.noesisbak` },
      { name: `${AUTO_BACKUP_PREFIX}20261101-000000.noesisbak` },
      { name: 'manual-backup.noesisbak' },
    ];

    const { kept, removed } = pruneBackupList(entries, BEFORE_AI_BACKUP_PREFIX, BEFORE_AI_BACKUP_KEEP);
    expect(removed.map((e) => e.name)).toEqual([
      `${BEFORE_AI_BACKUP_PREFIX}20261101-100000.noesisbak`,
      `${BEFORE_AI_BACKUP_PREFIX}20261102-100000.noesisbak`,
    ]);
    expect(kept.map((e) => e.name)).toEqual([
      `${AUTO_BACKUP_PREFIX}20261101-000000.noesisbak`,
      'manual-backup.noesisbak',
      `${BEFORE_AI_BACKUP_PREFIX}20261103-100000.noesisbak`,
      `${BEFORE_AI_BACKUP_PREFIX}20261104-100000.noesisbak`,
      `${BEFORE_AI_BACKUP_PREFIX}20261105-100000.noesisbak`,
      `${BEFORE_AI_BACKUP_PREFIX}20261106-100000.noesisbak`,
      `${BEFORE_AI_BACKUP_PREFIX}20261107-100000.noesisbak`,
    ]);
  });

  it('writes valid "before AI changes" snapshots, keeps only the newest 5 separately from auto backups, and restores cleanly', async () => {
    const s = await memoryStore();
    const blobs = memoryBlobs();
    const store = createMemoryBackupStore();
    const ws = (await s.workspaces.create('Research')).id;
    const page = await s.pages.create({ workspaceId: ws, title: 'Field Notes' });

    // Seed an existing daily/weekly automatic backup to prove it is kept separate.
    await store.save(new Uint8Array([1, 2, 3]), {
      kind: 'auto',
      keep: 7,
      label: 'automatic backup',
      now: Date.UTC(2026, 10, 1, 0, 0, 0),
    });

    const createdNames: string[] = [];
    for (let i = 1; i <= 7; i++) {
      await s.pages.saveContent(page.id, docFromParagraphs([`Revision ${i} before agent change`]));
      const res = await runBeforeAiBackup({
        db: s.db,
        blobs,
        store,
        now: Date.UTC(2026, 10, 10 + i, 12, 0, 0),
        recordTimestamp: false,
      });
      expect(res).not.toBeNull();
      createdNames.push(res!.name);
    }

    const listed = await listSavedBackups(store);
    const beforeAi = listed.filter((e) => e.kind === 'before-ai');
    const auto = listed.filter((e) => e.kind === 'auto');

    // Keeps only the newest 5 before-ai snapshots (revisions 3..7) and keeps auto backups untouched.
    expect(beforeAi).toHaveLength(BEFORE_AI_BACKUP_KEEP);
    expect(beforeAi.map((e) => e.name)).toEqual([...createdNames.slice(2)].reverse());
    expect(beforeAi.every((e) => e.label === BEFORE_AI_BACKUP_LABEL)).toBe(true);
    expect(auto).toHaveLength(1);

    // The oldest two snapshots were removed.
    await expect(readSavedBackup(createdNames[0], store)).rejects.toThrow(/Backup not found/);
    await expect(readSavedBackup(createdNames[1], store)).rejects.toThrow(/Backup not found/);

    // Every kept snapshot validates with manifest.label === "before AI changes" and restores its exact state.
    const rev3Bytes = await readSavedBackup(createdNames[2], store);
    const { manifest } = await inspectBackup(rev3Bytes);
    expect(manifest.label).toBe(BEFORE_AI_BACKUP_LABEL);

    // Simulate destructive edits after revision 7, then restore revision 3 through restoreBackup.
    await s.pages.trash(page.id);
    expect((await s.pages.get(page.id))!.deleted_at).not.toBeNull();

    const restoredManifest = await restoreBackup(s.db, rev3Bytes, blobs);
    expect(restoredManifest.label).toBe(BEFORE_AI_BACKUP_LABEL);
    const restoredPage = (await s.pages.get(page.id))!;
    expect(restoredPage.deleted_at).toBeNull();
    expect(restoredPage.content_text).toContain('Revision 3 before agent change');
  });

  it('defaults Prefs.backupBeforeAi to true and migrates older saved settings safely', async () => {
    expect(DEFAULT_PREFS.backupBeforeAi).toBe(true);
    expect(DEFAULT_PREFS.lastBeforeAiBackupAt).toBeNull();

    const s = await memoryStore();
    const prevMatchMedia = window.matchMedia;
    const prevState = useApp.getState();
    window.matchMedia = (() => ({ matches: false }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      useApp.setState({ repos: s });

      // Older saved prefs without backupBeforeAi migrate to default true.
      await s.settings.set('prefs', { theme: 'light' });
      await loadSettings();
      expect(useApp.getState().prefs.backupBeforeAi).toBe(true);
      expect(useApp.getState().prefs.lastBeforeAiBackupAt).toBeNull();

      // Explicit false is preserved across loadSettings.
      await s.settings.set('prefs', { theme: 'light', backupBeforeAi: false, lastBeforeAiBackupAt: 1_700_000_000_000 });
      await loadSettings();
      expect(useApp.getState().prefs.backupBeforeAi).toBe(false);
      expect(useApp.getState().prefs.lastBeforeAiBackupAt).toBe(1_700_000_000_000);

      // Malformed saved values fall back safely.
      await s.settings.set('prefs', { theme: 'light', backupBeforeAi: 'no', lastBeforeAiBackupAt: 'bad' });
      await loadSettings();
      expect(useApp.getState().prefs.backupBeforeAi).toBe(true);
      expect(useApp.getState().prefs.lastBeforeAiBackupAt).toBeNull();
    } finally {
      window.matchMedia = prevMatchMedia;
      useApp.setState({
        repos: prevState.repos,
        prefs: prevState.prefs,
        lang: prevState.lang,
        ai: prevState.ai,
        hasApiKey: prevState.hasApiKey,
        workspaceId: prevState.workspaceId,
      });
    }
  });
});
