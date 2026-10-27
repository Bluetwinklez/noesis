import { Archive, RotateCcw, Trash2 } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT } from '../../i18n';
import { Button, confirmDialog, EmptyState, PageHeader, useAsync, cx } from '../../components/ui';
import { relativeTime } from '../../lib/util';
import { reportError } from '../../app/services';

export default function TrashPage() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const version = useApp((s) => s.version);
  const bump = useApp((s) => s.bump);
  const navigate = useApp((s) => s.navigate);
  const { data } = useAsync(async () => ({ trash: await repos().pages.listTrash(wsId()), archived: await repos().pages.listArchived(wsId()) }), [version]);
  const run = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
      bump();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <div className="mx-auto max-w-[820px] px-8 py-10">
      <PageHeader
        icon={<Trash2 className="size-5" />}
        title={t('trash.title')}
        actions={
          !!data?.trash.length && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirmDialog(t('trash.emptyTrash'), t('trash.confirmEmpty'), { danger: true, confirmLabel: t('trash.deletePermanently') })) await run(() => repos().pages.emptyTrash(wsId()))();
              }}
            >
              {t('trash.emptyTrash')}
            </Button>
          )
        }
      />
      {!data?.trash.length ? (
        <EmptyState icon={<Trash2 className="size-5" />} title={t('trash.empty')} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-elevated">
          {data.trash.map((p, i) => (
            <div key={p.id} className={cx('flex items-center gap-3 px-4 py-2', i > 0 && 'border-t border-line')}>
              <button className="flex flex-1 items-center gap-2 truncate text-left text-sm" onClick={() => navigate({ name: 'page', id: p.id })}>
                <span>{p.icon ?? '📄'}</span>
                {p.title || t('common.untitled')}
              </button>
              <span className="text-xs text-faint">{relativeTime(p.deleted_at!, lang)}</span>
              <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={run(() => repos().pages.restore(p.id))}>
                {t('common.restore')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={async () => {
                  if (await confirmDialog(t('trash.deletePermanently'), t('trash.confirmPurge'), { danger: true })) await run(() => repos().pages.purge(p.id))();
                }}
              >
                {t('common.delete')}
              </Button>
            </div>
          ))}
        </div>
      )}
      {!!data?.archived.length && (
        <section className="mt-10">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
            <Archive className="size-3.5" /> {t('trash.archived')}
          </h2>
          <div className="overflow-hidden rounded-xl border border-line bg-elevated">
            {data.archived.map((p, i) => (
              <div key={p.id} className={cx('flex items-center gap-3 px-4 py-2', i > 0 && 'border-t border-line')}>
                <button className="flex-1 truncate text-left text-sm" onClick={() => navigate({ name: 'page', id: p.id })}>
                  {p.icon ?? '📄'} {p.title || t('common.untitled')}
                </button>
                <Button size="sm" onClick={run(() => repos().pages.setArchived(p.id, false))}>
                  {t('page.unarchive')}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
