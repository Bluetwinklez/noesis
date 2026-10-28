import { readSourceCoverage, type StudioPreparation } from '../../ai/studio-context';
import { useT } from '../../i18n';

export function StudioCoverage({ coverage: raw, progress }: { coverage: unknown; progress?: Parameters<NonNullable<StudioPreparation['onProgress']>>[0] | null }) {
  const t = useT();
  const coverage = readSourceCoverage(raw);
  if (!coverage.length && !progress) return null;
  return (
    <div role="status" aria-label={t('nb.coverage.title')} className="mt-3 space-y-1 rounded-lg border border-line bg-inset p-2 text-xs text-muted">
      <div className="font-medium">{t('nb.coverage.title')}</div>
      {progress && <p>{t('nb.coverage.progress', { title: progress.sourceTitle, done: progress.completed, total: progress.total })}</p>}
      {coverage.map((c) => (
        <div key={c.sourceId}>
          <span className="font-medium">{c.sourceTitle}: </span>
          {c.condensed ? t('nb.coverage.condensed', { n: c.parts }) : t('nb.coverage.full')}
          {c.representedChars < c.totalChars && <p className="text-warning">{t('nb.coverage.partial', { done: c.representedChars, total: c.totalChars })}</p>}
          {c.summaryClipped && <p className="text-warning">{t('nb.coverage.clipped')}</p>}
        </div>
      ))}
      {coverage.some((c) => c.condensed) && <p>{t('nb.coverage.lossy')}</p>}
    </div>
  );
}
