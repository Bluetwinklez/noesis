/**
 * Single "finish every write, then quit" path. Views with delayed saves (editor content,
 * titles) register a flusher; closing the window, quitting from the tray and installing
 * an update all call flushAllWrites() first.
 */
import { closeAction } from './closeBehavior';
import { notify } from '../lib/platform';
import { useApp } from './state';
import { t } from '../i18n';

type Flusher = () => Promise<void> | void;
const flushers = new Set<Flusher>();

export function registerFlusher(fn: Flusher): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

/** Runs every pending delayed save, waits for it, then drains the database queue. */
export async function flushAllWrites(): Promise<void> {
  await Promise.all([...flushers].map(async (f) => {
    try {
      await f();
    } catch (e) {
      console.warn('flush', e);
    }
  }));
  await useApp.getState().repos?.db.flushNow();
}

let trayAnnounced = false;
/** Once per run: tell the user the app was not closed, otherwise a hidden window looks like a crash. */
async function announceTray(): Promise<void> {
  if (trayAnnounced) return;
  trayAnnounced = true;
  try {
    await notify(t('tray.stillRunning.title'), t('tray.stillRunning.body'));
  } catch (e) {
    console.warn('tray notice', e);
  }
}

/** Desktop: flush before the window closes or the tray "Quit" exits the app. */
export async function hookQuit(): Promise<void> {
  const [{ getCurrentWindow }, { listen }, { exit }] = await Promise.all([
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/event'),
    import('@tauri-apps/plugin-process'),
  ]);
  // The only close handler (each handler would destroy the window on its own). Tauri waits
  // for it, then destroys the window unless it was prevented.
  await getCurrentWindow().onCloseRequested(async (event) => {
    await flushAllWrites();
    const { installOnClose, installUpdate } = await import('./updater');
    const action = closeAction({ closeToTray: useApp.getState().prefs.closeToTray, installUpdate: installOnClose() });
    if (action === 'install') {
      event.preventDefault();
      await installUpdate();
    } else if (action === 'hide') {
      // Everything is saved above; keep the process (and the tray icon) alive instead of destroying the window.
      event.preventDefault();
      await getCurrentWindow().hide();
      void announceTray();
    }
  });
  await listen('quit-requested', async () => {
    await flushAllWrites();
    await exit(0);
  });
}
