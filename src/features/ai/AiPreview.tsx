import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { Sparkles } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Button, Modal, Spinner } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage, providerWithConsent } from '../../app/services';
import { runAssistantAction, type AssistantAction } from '../../ai/assistant';
import { useApp } from '../../app/state';

export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false, gfm: true }) as string);
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`prose-noesis ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

interface PreviewRequest {
  action: AssistantAction;
  label: string;
  original: string;
  target?: string;
  /** Called only when the user explicitly accepts. */
  onReplace?: (markdown: string) => void;
  onInsert?: (markdown: string) => void;
}

const usePreview = create<{ req: PreviewRequest | null }>(() => ({ req: null }));

/** Opens the review dialog. AI output is never applied without an explicit choice. */
export function openAiPreview(req: PreviewRequest) {
  usePreview.setState({ req });
}

export function AiPreviewHost() {
  const t = useT();
  const req = usePreview((s) => s.req);
  const lang = useApp((s) => s.lang);
  const [out, setOut] = useState('');
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const ctrl = useRef<AbortController | null>(null);

  const run = async (r: PreviewRequest) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setOut('');
    setError('');
    setState('running');
    try {
      const provider = await providerWithConsent();
      const text = await runAssistantAction(provider, r.action, r.original, { lang, target: r.target, signal: c.signal, onToken: (d) => setOut((o) => o + d) });
      if (!c.signal.aborted) {
        setOut(text);
        setState('done');
      }
    } catch (e) {
      if (c.signal.aborted) return;
      setError(errorMessage(e));
      setState('error');
    }
  };

  useEffect(() => {
    if (req) void run(req);
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  const close = () => {
    ctrl.current?.abort();
    usePreview.setState({ req: null });
    setState('idle');
  };
  if (!req) return null;
  return (
    <Modal
      open
      onClose={close}
      width={760}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" /> {t('ai.preview')} · {req.label}
        </span>
      }
      footer={
        <>
          {state === 'running' && (
            <Button variant="ghost" onClick={() => ctrl.current?.abort()}>
              {t('common.stop')}
            </Button>
          )}
          {(state === 'error' || state === 'done') && (
            <Button variant="ghost" onClick={() => void run(req)}>
              {t('common.retry')}
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            {t('common.discard')}
          </Button>
          {req.onInsert && (
            <Button disabled={state !== 'done'} onClick={() => (req.onInsert!(out), close())}>
              {t('ai.insertBelow')}
            </Button>
          )}
          {req.onReplace && (
            <Button variant="primary" disabled={state !== 'done'} onClick={() => (req.onReplace!(out), close())}>
              {t('ai.replace')}
            </Button>
          )}
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">{t('ai.previewHint')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{t('ai.original')}</div>
          <div className="max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-inset p-3 text-sm text-muted">{req.original}</div>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
            {t('ai.suggestion')} {state === 'running' && <Spinner className="size-3" />}
          </div>
          <div className="max-h-[46vh] min-h-24 overflow-y-auto rounded-lg border border-accent/30 bg-accent-soft/40 p-3 text-sm">
            {state === 'error' ? <div className="text-danger">{error}</div> : out ? <Markdown text={out} /> : <span className="text-faint">{t('ai.generating')}</span>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
