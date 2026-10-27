import { useState } from 'react';
import { CheckCircle2, Info, ShieldAlert, X, XCircle } from 'lucide-react';
import { useApp } from '../../app/state';
import { savePrefs } from '../../app/services';
import { useT } from '../../i18n';
import { Button, Modal, cx } from '../ui';

export function ToastHost() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[360px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cx(
            'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-elevated p-3 text-sm shadow-pop animate-in',
            t.kind === 'error' ? 'border-danger/40' : 'border-line',
          )}
        >
          {t.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          ) : t.kind === 'error' ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          )}
          <span className="flex-1 break-words">{t.message}</span>
          {t.action && (
            <button
              className="shrink-0 text-[13px] font-medium text-accent hover:underline"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button aria-label="Dismiss" className="shrink-0 text-faint hover:text-fg" onClick={() => dismiss(t.id)}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Explicit permission before any local content is uploaded to a cloud AI provider. */
export function ConsentModal() {
  const t = useT();
  const consent = useApp((s) => s.consent);
  const prefs = useApp((s) => s.prefs);
  const [remember, setRemember] = useState(false);
  if (!consent) return null;
  const answer = async (ok: boolean) => {
    if (ok && remember && !prefs.cloudConsents.includes(consent.providerId)) {
      await savePrefs({ cloudConsents: [...prefs.cloudConsents, consent.providerId] });
    }
    setRemember(false);
    consent.resolve(ok);
  };
  return (
    <Modal
      open
      onClose={() => void answer(false)}
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning" />
          {t('ai.consent.title', { provider: consent.providerLabel })}
        </span>
      }
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => void answer(false)}>
            {t('ai.consent.deny')}
          </Button>
          <Button variant="primary" onClick={() => void answer(true)} autoFocus>
            {t('ai.consent.allow')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{t('ai.consent.body', { provider: consent.providerLabel })}</p>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--accent)]" />
        {t('ai.consent.remember')}
      </label>
    </Modal>
  );
}
