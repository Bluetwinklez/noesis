import { useMemo } from 'react';
import { LayoutGrid, Plus, ChevronRight } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT } from '../../i18n';
import { Button, EmptyState, PageHeader, useAsync } from '../../components/ui';
import { createDatabase, createPage } from '../actions';
import type { PageMeta } from '../../core/types';

/** Overview of the workspace hierarchy plus counts. */
export default function WorkspacePage() {
  const t = useT();
  const version = useApp((s) => s.version);
  const navigate = useApp((s) => s.navigate);
  const { data } = useAsync(async () => {
    const ws = wsId();
    const [workspaces, pages, tasks, notebooks, sources] = await Promise.all([
      repos().workspaces.list(),
      repos().pages.listTree(ws),
      repos().tasks.list(ws),
      repos().notebooks.list(ws),
      repos().sources.list(ws),
    ]);
    return { ws: workspaces.find((w) => w.id === ws), pages, tasks, notebooks, sources };
  }, [version]);
  const roots = useMemo(() => (data?.pages ?? []).filter((p) => !p.parent_id), [data]);
  const childrenOf = (id: string) => (data?.pages ?? []).filter((p) => p.parent_id === id);
  const stats = [
    { label: t('nav.pages'), value: data?.pages.filter((p) => p.kind === 'page').length ?? 0, route: { name: 'notes' } as const },
    { label: t('nav.databases'), value: data?.pages.filter((p) => p.kind === 'database').length ?? 0, route: { name: 'databases' } as const },
    { label: t('nav.tasks'), value: data?.tasks.filter((x) => x.status !== 'done').length ?? 0, route: { name: 'tasks' } as const },
    { label: t('nav.notebooks'), value: data?.notebooks.length ?? 0, route: { name: 'notebooks' } as const },
    { label: t('nav.sources'), value: data?.sources.length ?? 0, route: { name: 'sources' } as const },
  ];
  const Node = ({ p, depth }: { p: PageMeta; depth: number }) => (
    <>
      <button onClick={() => navigate({ name: 'page', id: p.id })} className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm hover:bg-hover" style={{ paddingLeft: 8 + depth * 18 }}>
        {depth > 0 && <ChevronRight className="size-3 text-faint" />}
        <span>{p.icon ?? (p.kind === 'database' ? '🗂️' : '📄')}</span>
        <span className="truncate">{p.title || t('common.untitled')}</span>
      </button>
      {depth < 4 && childrenOf(p.id).map((c) => <Node key={c.id} p={c} depth={depth + 1} />)}
    </>
  );
  return (
    <div className="mx-auto max-w-[980px] px-8 py-10">
      <PageHeader
        icon={<LayoutGrid className="size-5" />}
        title={data?.ws?.name ?? t('nav.workspace')}
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => void createDatabase()}>
              {t('db.new')}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => void createPage()}>
              {t('nav.newPage')}
            </Button>
          </>
        }
      />
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <button key={s.label} onClick={() => navigate(s.route)} className="rounded-xl border border-line bg-elevated p-4 text-left hover:shadow-soft">
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="text-xs text-muted">{s.label}</div>
          </button>
        ))}
      </div>
      {roots.length === 0 ? <EmptyState title={t('home.empty')} /> : <div className="rounded-xl border border-line bg-elevated p-2">{roots.map((p) => <Node key={p.id} p={p} depth={0} />)}</div>}
    </div>
  );
}
