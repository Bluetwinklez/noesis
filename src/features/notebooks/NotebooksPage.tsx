import { BookOpen, Plus } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT } from '../../i18n';
import { Button, EmptyState, PageHeader, useAsync } from '../../components/ui';
import { createNotebook } from '../actions';
import { relativeTime } from '../../lib/util';

export default function NotebooksPage() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const version = useApp((s) => s.version);
  const navigate = useApp((s) => s.navigate);
  const { data } = useAsync(() => repos().notebooks.list(wsId()), [version]);
  return (
    <div className="mx-auto max-w-[1040px] px-8 py-10">
      <PageHeader
        icon={<BookOpen className="size-5" />}
        title={t('nb.title')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => void createNotebook()}>
            {t('nb.new')}
          </Button>
        }
      />
      {data?.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-5" />}
          title={t('nb.title')}
          body={t('nb.empty')}
          action={
            <Button variant="primary" onClick={() => void createNotebook()}>
              {t('nb.new')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            onClick={() => void createNotebook()}
            className="flex h-44 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong text-muted hover:border-accent hover:text-accent"
          >
            <Plus className="size-6" />
            <span className="text-sm font-medium">{t('nb.new')}</span>
          </button>
          {data?.map((nb) => (
            <button
              key={nb.id}
              onClick={() => navigate({ name: 'notebook', id: nb.id })}
              className="flex h-44 flex-col justify-between rounded-2xl border border-line bg-gradient-to-br from-elevated to-inset p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"
            >
              <div className="text-3xl">{nb.icon ?? '📓'}</div>
              <div>
                <div className="line-clamp-2 font-semibold">{nb.title}</div>
                <div className="mt-1 text-xs text-faint">
                  {nb.source_count} · {t('nb.sources')} · {relativeTime(nb.updated_at, lang)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
