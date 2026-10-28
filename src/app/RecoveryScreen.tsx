import { useState } from 'react';
import { useT } from '../i18n';
import { useApp } from './state';
import { appInfo, isTauri, pickFiles, saveFile } from '../lib/platform';
import { openRecoveryBackups, rawRecoveryArchive, restoreFromRecovery } from './recovery';
import { errorDetails } from '../components/ErrorBoundary';

/** Independent of repositories, normal routing, settings and the failed DB. */
export function RecoveryScreen({ error }: { error: Error }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [details, setDetails] = useState('');
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setFailure('');
    try { await action(); } catch (e) { setFailure(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <main className="flex h-full items-center justify-center overflow-auto bg-bg p-8">
    <section className="flex w-full max-w-2xl flex-col gap-4" aria-label={t('recovery.title')}>
      <div className="flex gap-2 text-sm"><button onClick={() => useApp.setState({ lang: 'en' })}>English</button><button onClick={() => useApp.setState({ lang: 'tr' })}>Türkçe</button></div>
      <h1 className="text-2xl font-semibold">{t('recovery.title')}</h1>
      <p className="text-sm text-muted">{t('recovery.help')}</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-inset p-3 text-xs text-danger">{error.message}</pre>
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-50" onClick={() => void run(async () => {
          const [file] = await pickFiles('.noesisbak', false);
          if (!file) return;
          if (!window.confirm(t('recovery.confirmRestore'))) return;
          await restoreFromRecovery(file.bytes);
          location.reload();
        })}>{t('recovery.restore')}</button>
        {isTauri() && <button disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm" onClick={() => void run(openRecoveryBackups)}>{t('recovery.openBackups')}</button>}
        <button disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm" onClick={() => void run(async () => { await saveFile('noesis-raw-recovery.zip', await rawRecoveryArchive()); })}>{t('recovery.exportRaw')}</button>
        <button disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm" onClick={() => void run(async () => {
          const info = await appInfo().catch(() => null);
          const text = errorDetails(error) + '\n' + JSON.stringify({ storage: isTauri() ? 'desktop' : 'browser', info }, null, 2);
          setDetails(text);
          await navigator.clipboard?.writeText(text);
        })}>{t('recovery.copyDiagnostics')}</button>
        <button disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm" onClick={() => location.reload()}>{t('common.retry')}</button>
      </div>
      <p className="text-xs text-muted">{t('recovery.rawHelp')}</p>
      {busy && <p role="status">{t('recovery.working')}</p>}
      {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
      {details && <textarea readOnly aria-label={t('recovery.copyDiagnostics')} value={details} className="h-40 rounded-lg border border-line bg-inset p-3 text-xs" />}
    </section>
  </main>;
}
