import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Columns2, X } from 'lucide-react';
import { repos, useApp } from '../../app/state';
import { registerFlusher } from '../../app/pendingWrites';
import { closeTab, EMPTY_TABS, normalizeTabs, openTab, type PageTabs as TabsState } from '../../app/tabs';
import { useT } from '../../i18n';
import { cx, IconButton, Spinner } from '../../components/ui';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import type { PageMeta } from '../../core/types';
import { reportError } from '../../app/services';

const PageView = lazy(() => import('./PageView').then((module) => ({ default: module.PageView })));

export function PageTabs({ id }: { id: string }) {
  const t = useT();
  const workspaceId = useApp((state) => state.workspaceId)!;
  const version = useApp((state) => state.version);
  const navigate = useApp((state) => state.navigate);
  const [tabs, setTabs] = useState<TabsState>(EMPTY_TABS);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [ready, setReady] = useState(false);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const key = `pageTabs:${workspaceId}`;
  useEffect(() => {
    let alive = true;
    setReady(false);
    void Promise.all([repos().pages.listTree(workspaceId), repos().settings.get<Partial<TabsState>>(key, {})]).then(([list, saved]) => {
      if (!alive) return;
      setPages(list);
      setTabs(openTab(normalizeTabs(saved, new Set(list.map((page) => page.id))), id));
      setReady(true);
    });
    return () => { alive = false; };
  }, [workspaceId, key]);
  useEffect(() => { if (ready) setTabs((current) => current.active === id ? current : openTab(current, id)); }, [id, ready]);
  useEffect(() => { if (ready) void repos().pages.listTree(workspaceId).then(setPages); }, [workspaceId, version, ready]);
  useEffect(() => {
    if (!ready) return;
    writes.current = writes.current.catch(() => undefined).then(() => repos().settings.set(key, tabs));
  }, [tabs, ready, key]);
  useEffect(() => registerFlusher(async () => { await writes.current; }), []);
  const close = useCallback(async (tab: string) => {
    const next = closeTab(tabs, tab);
    setTabs(next);
    try {
      await writes.current;
      await repos().settings.set(key, next);
      if (tabs.active === tab) navigate(next.active ? { name: 'page', id: next.active } : { name: 'home' });
    } catch (error) { reportError(error); }
  }, [tabs, navigate, key]);
  if (!ready) return <Spinner />;
  const split = tabs.split && tabs.split !== id ? tabs.split : null;
  const renderPage = (pageId: string) => <ErrorBoundary key={pageId}><Suspense fallback={<Spinner />}><PageView id={pageId} /></Suspense></ErrorBoundary>;
  return <div>
    <nav aria-label={t('tabs.label')} className="flex items-center gap-1 overflow-x-auto border-b border-line px-2">
      {tabs.ids.map((tab) => <div key={tab} className={cx('flex items-center rounded-t-md', tab === id ? 'bg-elevated text-fg' : 'text-muted')}>
        <button className="max-w-40 truncate px-3 py-2 text-xs" onClick={() => navigate({ name: 'page', id: tab })}>{pages.find((page) => page.id === tab)?.title || t('common.untitled')}</button>
        <IconButton size="sm" label={t('tabs.split')} disabled={tab === id} onClick={() => setTabs((current) => ({ ...current, split: current.split === tab ? null : tab }))}><Columns2 className="size-3" /></IconButton>
        <IconButton size="sm" label={t('tabs.close')} onClick={() => void close(tab)}><X className="size-3" /></IconButton>
      </div>)}
    </nav>
    <div className={cx(split && 'grid grid-cols-2 divide-x divide-line')}>
      <div className="min-w-0">{renderPage(id)}</div>
      {split && <div className="min-w-0">{renderPage(split)}</div>}
    </div>
  </div>;
}
