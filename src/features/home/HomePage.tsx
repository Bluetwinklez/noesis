import { BookOpen, CheckSquare, Database, FilePlus, FileText, Library, Clock, CalendarClock } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT } from '../../i18n';
import { cx, useAsync } from '../../components/ui';
import { createDatabase, createNotebook, createPage } from '../actions';
import { relativeTime } from '../../lib/util';

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl border border-line bg-elevated p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-soft"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

export function HomePage() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const version = useApp((s) => s.version);
  const navigate = useApp((s) => s.navigate);
  const ws = wsId();
  const { data } = useAsync(async () => {
    const r = repos();
    const [recent, edited, tasks, notebooks] = await Promise.all([
      r.pages.listRecentVisited(ws, 6),
      r.pages.listRecentlyEdited(ws, 8),
      r.tasks.list(ws),
      r.notebooks.list(ws),
    ]);
    const due = tasks
      .filter((x) => x.status !== 'done' && x.status !== 'cancelled' && x.due_at)
      .sort((a, b) => a.due_at! - b.due_at!)
      .slice(0, 6);
    return { recent, edited, due, notebooks: notebooks.slice(0, 4) };
  }, [ws, version]);

  const h = new Date().getHours();
  const greet = h < 12 ? t('home.greeting.morning') : h < 18 ? t('home.greeting.afternoon') : t('home.greeting.evening');
  const today = new Date().toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto max-w-[980px] px-8 py-10 animate-in">
      <div className="mb-8">
        <div className="text-sm text-muted">{today}</div>
        <h1 className="font-display text-[32px] font-bold tracking-tight">{greet}</h1>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
        <QuickAction icon={<FilePlus className="size-4" />} label={t('home.quick.page')} onClick={() => void createPage()} />
        <QuickAction icon={<BookOpen className="size-4" />} label={t('home.quick.notebook')} onClick={() => void createNotebook()} />
        <QuickAction icon={<Library className="size-4" />} label={t('home.quick.import')} onClick={() => navigate({ name: 'sources' })} />
        <QuickAction icon={<Database className="size-4" />} label={t('home.quick.database')} onClick={() => void createDatabase()} />
      </div>

      {data && data.recent.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
            <Clock className="size-3.5" /> {t('home.recent')}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {data.recent.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate({ name: 'page', id: p.id })}
                className="flex h-28 flex-col justify-between overflow-hidden rounded-xl border border-line bg-elevated text-left shadow-sm transition hover:shadow-soft"
              >
                <div className="h-8 w-full" style={{ background: p.cover ?? 'var(--bg-inset)' }} />
                <div className="px-3 pb-3">
                  <div className="-mt-5 mb-1 text-[22px] leading-none">{p.icon ?? '📄'}</div>
                  <div className="truncate text-[13px] font-medium">{p.title || t('common.untitled')}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
            <FileText className="size-3.5" /> {t('home.edited')}
          </h2>
          <div className="rounded-xl border border-line bg-elevated">
            {data?.edited.length === 0 && <p className="p-4 text-sm text-muted">{t('home.empty')}</p>}
            {data?.edited.map((p, i) => (
              <button
                key={p.id}
                onClick={() => navigate({ name: 'page', id: p.id })}
                className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover', i > 0 && 'border-t border-line')}
              >
                <span>{p.icon ?? '📄'}</span>
                <span className="flex-1 truncate text-sm">{p.title || t('common.untitled')}</span>
                <span className="text-xs text-faint">{relativeTime(p.updated_at, lang)}</span>
              </button>
            ))}
          </div>
        </section>
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
              <CalendarClock className="size-3.5" /> {t('home.dueTasks')}
            </h2>
            <div className="rounded-xl border border-line bg-elevated">
              {data?.due.length === 0 && <p className="p-4 text-sm text-muted">{t('task.empty')}</p>}
              {data?.due.map((task, i) => {
                const overdue = task.due_at! < Date.now();
                return (
                  <button key={task.id} onClick={() => navigate({ name: 'tasks' })} className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover', i > 0 && 'border-t border-line')}>
                    <CheckSquare className="size-4 text-muted" />
                    <span className="flex-1 truncate text-sm">{task.title}</span>
                    <span className={cx('text-xs', overdue ? 'text-danger' : 'text-faint')}>{new Date(task.due_at!).toLocaleDateString(lang)}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
              <BookOpen className="size-3.5" /> {t('home.notebooks')}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {data?.notebooks.map((nb) => (
                <button key={nb.id} onClick={() => navigate({ name: 'notebook', id: nb.id })} className="rounded-xl border border-line bg-elevated p-3 text-left hover:shadow-soft">
                  <div className="text-xl">{nb.icon ?? '📓'}</div>
                  <div className="truncate text-sm font-medium">{nb.title}</div>
                  <div className="text-xs text-faint">{nb.source_count} · {t('nb.sources')}</div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
