import { Database, Plus } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT } from '../../i18n';
import { Button, EmptyState, PageHeader, useAsync } from '../../components/ui';
import { createDatabase } from '../actions';
import { relativeTime } from '../../lib/util';

export default function DatabasesPage() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const version = useApp((s) => s.version);
  const navigate = useApp((s) => s.navigate);
  const { data } = useAsync(() => repos().databases.listDatabases(wsId()), [version]);
  return (
    <div className="mx-auto max-w-[980px] px-8 py-10">
      <PageHeader
        icon={<Database className="size-5" />}
        title={t('db.title')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => void createDatabase()}>
            {t('db.new')}
          </Button>
        }
      />
      {data?.length === 0 ? (
        <EmptyState icon={<Database className="size-5" />} title={t('db.title')} body={t('db.empty')} action={<Button variant="primary" onClick={() => void createDatabase()}>{t('db.new')}</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.map((d) => (
            <button key={d.id} onClick={() => navigate({ name: 'page', id: d.id })} className="rounded-xl border border-line bg-elevated p-4 text-left shadow-sm hover:shadow-soft">
              <div className="mb-2 text-2xl">{d.icon ?? '🗂️'}</div>
              <div className="truncate font-medium">{d.title || t('common.untitled')}</div>
              <div className="text-xs text-faint">
                {t('db.rows', { n: d.row_count })} · {relativeTime(d.updated_at, lang)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
