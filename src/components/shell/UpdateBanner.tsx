import { Download, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { installUpdate, useUpdates } from '../../app/updater';
import { useT } from '../../i18n';
import { Button, IconButton } from '../ui';

/** Unobtrusive bottom-right card shown while an update downloads and once it is ready. */
export function UpdateBanner() {
  const t = useT();
  const { status, available, progress } = useUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!available || dismissed === available.version) return null;
  if (status !== 'downloading' && status !== 'ready' && status !== 'installing') return null;
  return (
    <div role="status" className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-line bg-elevated p-3 shadow-lg">
      <div className="flex items-start gap-2">
        {status === 'downloading' ? <Download className="mt-0.5 size-4 shrink-0 text-accent" /> : <RefreshCw className="mt-0.5 size-4 shrink-0 text-accent" />}
        <div className="min-w-0 flex-1 text-sm">
          {status === 'downloading' ? (
            <>
              <div>{t('upd.downloading', { v: available.version, p: Math.round(progress * 100) })}</div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-line">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            </>
          ) : (
            <>
              <div className="font-medium">{t('upd.ready', { v: available.version })}</div>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" disabled={status === 'installing'} onClick={() => void installUpdate()}>
                  {t('upd.restart')}
                </Button>
                <Button variant="ghost" onClick={() => setDismissed(available.version)}>
                  {t('upd.later')}
                </Button>
              </div>
            </>
          )}
        </div>
        {status === 'ready' && (
          <IconButton label={t('upd.later')} onClick={() => setDismissed(available.version)}>
            <X className="size-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
