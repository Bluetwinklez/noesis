import { create } from 'zustand';
import { isTauri } from '../lib/platform';
import { flushAllWrites } from './pendingWrites';
import { useApp } from './state';
import { savePrefs } from './services';
import { t } from '../i18n';

/**
 * In-app updates. Every push to main publishes a signed build; the desktop app
 * checks GitHub on start and every few hours, downloads the update in the
 * background and offers "Restart to update" (or installs on its own when
 * automatic installation is enabled). The browser preview has no updater.
 */

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'installing' | 'error' | 'unsupported';

interface UpdateState {
  status: UpdateStatus;
  current: string | null;
  available: { version: string; notes: string; date: string | null } | null;
  progress: number;
  error: string | null;
  checkedAt: number | null;
}

export const useUpdates = create<UpdateState>(() => ({
  status: isTauri() ? 'idle' : 'unsupported',
  current: null,
  available: null,
  progress: 0,
  error: null,
  checkedAt: null,
}));

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
type PendingUpdate = { install(): Promise<void>; download(cb?: (e: DownloadEvent) => void): Promise<void> };
type DownloadEvent = { event: 'Started'; data: { contentLength?: number } } | { event: 'Progress'; data: { chunkLength: number } } | { event: 'Finished' };
let pending: PendingUpdate | null = null;
let busy = false;

export async function currentVersion(): Promise<string> {
  if (!isTauri()) return import.meta.env.VITE_APP_VERSION ?? '0.1.0';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/** Checks GitHub for a newer signed build and downloads it in the background. */
export async function checkForUpdates(opts: { manual?: boolean } = {}): Promise<void> {
  if (!isTauri() || busy) return;
  busy = true;
  const set = useUpdates.setState;
  try {
    set({ current: await currentVersion(), error: null });
    if (useUpdates.getState().status === 'ready') return;
    set({ status: 'checking' });
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    set({ checkedAt: Date.now() });
    if (!update) {
      set({ status: 'up-to-date', available: null });
      if (opts.manual) useApp.getState().toast(`Noesis ${useUpdates.getState().current} is up to date.`, 'success');
      return;
    }
    set({ available: { version: update.version, notes: update.body ?? '', date: update.date ?? null }, status: 'downloading', progress: 0 });
    let total = 0;
    let got = 0;
    await update.download((e: DownloadEvent) => {
      if (e.event === 'Started') total = e.data.contentLength ?? 0;
      else if (e.event === 'Progress') {
        got += e.data.chunkLength;
        set({ progress: total ? Math.min(1, got / total) : 0 });
      }
    });
    pending = update as unknown as PendingUpdate;
    set({ status: 'ready', progress: 1 });
    // Never restart under the user's hands: with automatic installation the update is
    // applied when the window closes; otherwise the banner offers "Restart now".
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // No signed build published yet (or offline): say so instead of the plugin's raw error.
    const message = /valid release JSON|404|error sending request/i.test(raw) ? t('upd.noChannel') : raw;
    set({ status: 'error', error: message });
    if (opts.manual) useApp.getState().toast(`Update check failed: ${message}`, 'error');
  } finally {
    busy = false;
  }
}

/** Installs the downloaded update and restarts the app. Unsaved edits are flushed first. */
export async function installUpdate(): Promise<void> {
  if (!pending) return;
  useUpdates.setState({ status: 'installing' });
  await flushAllWrites();
  await pending.install();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/**
 * With automatic installation a downloaded update is applied when the window closes
 * (never under the user's hands); the close handler lives in pendingWrites.hookQuit.
 */
export const installOnClose = (): boolean => !!pending && useApp.getState().prefs.autoInstallUpdates;

export function startUpdateLoop(): void {
  if (!isTauri()) return;
  void currentVersion().then((v) => useUpdates.setState({ current: v }));
  if (!useApp.getState().prefs.checkUpdates) return;
  setTimeout(() => void checkForUpdates(), 15_000);
  setInterval(() => {
    if (useApp.getState().prefs.checkUpdates) void checkForUpdates();
  }, CHECK_EVERY_MS);
}

export async function setUpdatePrefs(patch: { checkUpdates?: boolean; autoInstallUpdates?: boolean }) {
  await savePrefs(patch);
  if (patch.checkUpdates) void checkForUpdates();
}
