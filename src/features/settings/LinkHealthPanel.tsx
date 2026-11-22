import { useEffect, useState } from 'react';
import { Layers, Unlink } from 'lucide-react';
import { repos, useApp } from '../../app/state';
import { useT } from '../../i18n';
import { Badge, Button } from '../../components/ui';
import { reportError } from '../../app/services';
import type { LinkHealthReport } from '../../core/repos/pages';

export function LinkHealthPanel() {
  const t = useT();
  const workspaceId = useApp((s) => s.workspaceId);
  const navigate = useApp((s) => s.navigate);
  const [report, setReport] = useState<LinkHealthReport | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setReport(null);
  }, [workspaceId]);

  const check = async () => {
    if (!workspaceId) return;
    setChecking(true);
    try {
      setReport(await repos().pages.linkHealth(workspaceId));
    } catch (e) {
      reportError(e);
    } finally {
      setChecking(false);
    }
  };

  const totalIssues = report ? report.brokenLinks.length + report.orphans.length : 0;

  return (
    <div className="border-b border-line py-4">
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="text-sm font-medium">{t('linkHealth.title')}</div>
          <div className="mt-0.5 text-xs text-muted">{t('linkHealth.hint')}</div>
        </div>
        <div className="shrink-0">
          <Button
            size="sm"
            icon={<Unlink className="size-3.5" />}
            loading={checking}
            disabled={!workspaceId || checking}
            onClick={() => void check()}
          >
            {t('linkHealth.check')}
          </Button>
        </div>
      </div>

      {report !== null && totalIssues === 0 && (
        <p className="mt-3 text-xs text-muted">{t('linkHealth.none')}</p>
      )}

      {report !== null && totalIssues > 0 && (
        <div className="mt-3 space-y-3">
          <div className="text-xs text-muted">
            {t('linkHealth.summary', {
              broken: report.brokenLinks.length,
              orphans: report.orphans.length,
            })}
          </div>

          {report.brokenLinks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted">{t('linkHealth.brokenLinks')}</div>
              <ul aria-label={t('linkHealth.brokenLinks')} className="space-y-1.5">
                {report.brokenLinks.map((link) => (
                  <li
                    key={`${link.source_id}:${link.target_id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-xs"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Unlink className="size-3.5 shrink-0 text-muted" />
                      <button
                        type="button"
                        onClick={() => navigate({ name: 'page', id: link.source_id })}
                        className="truncate font-medium text-fg hover:underline"
                      >
                        {link.source_title || t('common.untitled')}
                      </button>
                      <span className="text-faint">→</span>
                      <span className="truncate text-muted">
                        {link.target_title !== null ? link.target_title || t('common.untitled') : link.target_id}
                      </span>
                    </div>
                    <Badge color={link.reason === 'trashed' ? 'amber' : 'red'}>
                      {link.reason === 'trashed' ? t('linkHealth.reason.trashed') : t('linkHealth.reason.missing')}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.orphans.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted">{t('linkHealth.orphans')}</div>
              <ul aria-label={t('linkHealth.orphans')} className="space-y-1.5">
                {report.orphans.map((orphan) => (
                  <li
                    key={orphan.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-elevated px-3 py-2 text-xs"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Layers className="size-3.5 shrink-0 text-muted" />
                      <button
                        type="button"
                        onClick={() => navigate({ name: 'page', id: orphan.id })}
                        className="truncate font-medium text-fg hover:underline"
                      >
                        {orphan.title || t('common.untitled')}
                      </button>
                      <span className="text-faint">·</span>
                      <span className="truncate text-muted">
                        {t('linkHealth.parent')}:{' '}
                        {orphan.parent_title !== null ? orphan.parent_title || t('common.untitled') : orphan.parent_id}
                      </span>
                    </div>
                    <Badge color={orphan.reason === 'trashed' ? 'amber' : 'red'}>
                      {orphan.reason === 'trashed' ? t('linkHealth.reason.trashed') : t('linkHealth.reason.missing')}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
