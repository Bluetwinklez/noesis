/**
 * Background housekeeping driven by Settings: automatic backups (desktop), emptying
 * old trash, search-index self-healing, and remembering the last opened page for
 * "Open on start: last page".
 */
import type { Database } from '../core/db/driver';
import type { Repos } from '../core/store';
import { createBackup } from '../core/backup';
import {
  rebuildSearchIndex,
  searchIndexMismatch,
  type RebuildSearchIndexOptions,
  type SearchIndexCounts,
} from '../core/search-rebuild';
import { t } from '../i18n';
import { blobStore, isTauri, packBinary } from '../lib/platform';
import { useApp, type Prefs } from './state';
import { savePrefs } from './services';

const DAY_MS = 86_400_000;
const LAST_PAGE_KEY = 'lastPage';
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.1.0';

/** Pages that stayed in the trash longer than the chosen number of days are deleted for good. */
export async function purgeOldTrash(repos: Repos, days: number, now = Date.now()): Promise<number> {
  if (!days) return 0;
  let purged = 0;
  for (const ws of await repos.workspaces.list()) {
    for (const p of await repos.pages.listTrash(ws.id)) {
      if (p.deleted_at && now - p.deleted_at > days * DAY_MS) {
        await repos.pages.purge(p.id);
        purged++;
      }
    }
  }
  return purged;
}

export function autoBackupDue(prefs: Pick<Prefs, 'autoBackup' | 'lastAutoBackupAt'>, now = Date.now()): boolean {
  if (prefs.autoBackup === 'off') return false;
  const every = prefs.autoBackup === 'daily' ? DAY_MS : 7 * DAY_MS;
  return !prefs.lastAutoBackupAt || now - prefs.lastAutoBackupAt >= every;
}

/** Desktop only: writes a full backup into the app's own backups folder (Rust picks the path). */
export async function runAutoBackup(): Promise<{ dir: string; count: number }> {
  const { repos, prefs } = useApp.getState();
  if (!repos) throw new Error('Noesis is still starting.');
  const bytes = await createBackup(repos.db, blobStore, APP_VERSION);
  const { invoke } = await import('@tauri-apps/api/core');
  const res = await invoke<{ dir: string; count: number }>('backup_auto_save', packBinary({ keep: prefs.autoBackupKeep }, bytes));
  await savePrefs({ lastAutoBackupAt: Date.now() });
  return res;
}

/**
 * Compares live and indexed page counts for a workspace and rebuilds the search
 * index when they differ. Returns rebuilt counts, or null when already in sync.
 */
export async function healSearchIndexIfNeeded(
  db: Database,
  workspaceId: string,
  options?: RebuildSearchIndexOptions,
): Promise<SearchIndexCounts | null> {
  const { mismatch } = await searchIndexMismatch(db, workspaceId);
  if (!mismatch) return null;
  return rebuildSearchIndex(db, workspaceId, options);
}

let searchIndexChecked = false;
/** Checks and heals the active workspace's search index at most once per launch. */
export async function checkSearchIndexOnStartup(): Promise<SearchIndexCounts | null> {
  if (searchIndexChecked) return null;
  const { repos, workspaceId, toast, bump } = useApp.getState();
  if (!repos || !workspaceId) return null;
  searchIndexChecked = true;
  try {
    const counts = await healSearchIndexIfNeeded(repos.db, workspaceId);
    if (counts) {
      bump();
      toast(t('settings.indexHealed', { pages: counts.pages }), 'info');
    }
    return counts;
  } catch (e) {
    console.warn('search index self-heal', e);
    return null;
  }
}

let started = false;
export function startMaintenance() {
  if (started) return;
  started = true;
  // Self-heal a stale search index once per launch in the background after boot.
  setTimeout(() => void checkSearchIndexOnStartup(), 0);
  const tick = async () => {
    const { repos, prefs } = useApp.getState();
    if (!repos) return;
    try {
      await purgeOldTrash(repos, prefs.trashRetentionDays);
      if (isTauri() && autoBackupDue(prefs)) await runAutoBackup();
    } catch (e) {
      console.warn('maintenance', e);
    }
  };
  // Shortly after start (not during it), then hourly.
  setTimeout(() => void tick(), 30_000);
  setInterval(() => void tick(), 60 * 60_000);

  // Remember the open page for "Open on start: last page".
  let last: string | null = null;
  useApp.subscribe((s) => {
    const id = s.route.name === 'page' ? s.route.id : null;
    if (id && id !== last && s.repos) {
      last = id;
      void s.repos.settings.set(LAST_PAGE_KEY, id);
    }
  });
}

/** Opens the page that was open last time, if the user chose that and it still exists. */
export async function openStartPage() {
  const { repos, prefs, workspaceId, navigate } = useApp.getState();
  if (!repos || prefs.startPage !== 'last') return;
  const id = await repos.settings.get<string | null>(LAST_PAGE_KEY, null);
  const page = id ? await repos.pages.get(id) : null;
  if (page && !page.deleted_at && page.workspace_id === workspaceId) navigate({ name: 'page', id: page.id }, { replace: true });
}
