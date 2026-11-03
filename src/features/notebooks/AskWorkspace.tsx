import { useEffect, useRef, useState } from 'react';
import { repos, useApp, wsId } from '../../app/state';
import { providerWithConsent, reportError } from '../../app/services';
import { answerWorkspaceQuestion } from '../../ai/workspace-retrieval';
import { useT } from '../../i18n';
import { Button } from '../../components/ui';
import { EvidenceAnswer } from './EvidenceAnswer';

export function AskWorkspace() {
  const t = useT();
  const lang = useApp((state) => state.lang);
  const workspaceId = useApp((state) => state.workspaceId);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof answerWorkspaceQuestion>> | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { controller.current?.abort(); setResult(null); }, [workspaceId]);
  const ask = async () => {
    if (!question.trim() || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setResult(null);
    try {
      const provider = await providerWithConsent();
      abort.signal.throwIfAborted();
      const answer = await answerWorkspaceQuestion(repos().db, wsId(), provider, question.trim(), lang, abort.signal);
      if (!abort.signal.aborted) setResult(answer);
    } catch (error) {
      if (!abort.signal.aborted) reportError(error);
    } finally { setBusy(false); }
  };
  return <section className="mb-6 rounded-xl border border-line bg-elevated p-4" aria-label={t('workspaceAsk.title')}>
    <h2 className="font-semibold">{t('workspaceAsk.title')}</h2>
    <p className="mt-1 text-xs text-muted">{t('workspaceAsk.hint')}</p>
    <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
      <input className="min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-3 text-sm" aria-label={t('workspaceAsk.question')} value={question} onChange={(event) => setQuestion(event.target.value)} />
      {busy ? <Button type="button" onClick={() => controller.current?.abort()}>{t('common.stop')}</Button> : <Button type="submit" variant="primary" disabled={!question.trim()}>{t('ai.ask')}</Button>}
    </form>
    {result && <div className="mt-4 text-sm" aria-live="polite">
      {result.insufficient && <div role="note" className="mb-2 text-xs text-warning">{t('nb.unsupportedAnswer')}</div>}
      <EvidenceAnswer text={result.text} citations={result.citations} onOpen={(citation) => {
        const item = result.evidence[citation.n - 1];
        if (!item) return;
        if (item.kind === 'page') useApp.getState().navigate({ name: 'page', id: item.id });
        else useApp.getState().navigate({ name: 'sources', id: item.id, highlight: { start: item.start, end: item.end } });
      }} />
      {result.citations.length > 0 && <p className="mt-2 text-xs text-muted">{t('nb.citationDisclaimer')}</p>}
    </div>}
  </section>;
}
