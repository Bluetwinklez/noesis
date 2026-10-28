import { setPdfJsLoader } from '../ingestion/extractors';
import { isTauri } from '../lib/platform';
import { openStore } from '../core/store';
import type { SqlDriver } from '../core/db/driver';
import { useApp } from './state';
import { applyTheme, loadSettings, startReminderLoop } from './services';
import { startUpdateLoop } from './updater';
import { startMcpIfEnabled } from '../mcp/host';
import { openStartPage, startMaintenance } from './maintenance';
import { flushAllWrites, hookQuit } from './pendingWrites';

export async function boot(): Promise<void> {
  setPdfJsLoader(async () => {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs as never;
  });

  let driver: SqlDriver;
  if (isTauri()) {
    const { TauriDriver } = await import('../core/db/tauri-driver');
    driver = new TauriDriver();
  } else {
    const { WasmDriver } = await import('../core/db/wasm-driver');
    driver = await WasmDriver.open(new URLSearchParams(location.search).get('db') ?? 'main');
  }
  const repos = await openStore(driver);
  useApp.setState({ repos, storageKind: driver.kind });
  await loadSettings();

  // Validate the remembered workspace still exists.
  const list = await repos.workspaces.list();
  const cur = useApp.getState().workspaceId;
  if (!cur || !list.some((w) => w.id === cur)) useApp.setState({ workspaceId: list[0]?.id ?? null });

  window.addEventListener('online', () => useApp.setState({ online: true }));
  window.addEventListener('offline', () => useApp.setState({ online: false }));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { prefs } = useApp.getState();
    if (prefs.theme === 'system') applyTheme(prefs);
  });
  // Finish delayed saves before the tab or window goes away.
  window.addEventListener('pagehide', () => void flushAllWrites());
  if (isTauri()) void hookQuit();
  await openStartPage();
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => applyTheme(useApp.getState().prefs));
  startReminderLoop();
  startMaintenance();
  startUpdateLoop();
  startMcpIfEnabled();
  // Dev-only handle for debugging and e2e diagnostics.
  if (import.meta.env.DEV) (window as unknown as { __noesis: typeof useApp }).__noesis = useApp;
}
