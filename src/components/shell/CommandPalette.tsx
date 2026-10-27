import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, CheckSquare, Database, FileText, Home, Library, Moon, Network, Plus, Search, Settings, Star, Trash2 } from 'lucide-react';
import { useApp, repos, type Route } from '../../app/state';
import { useT } from '../../i18n';
import { cx, Kbd } from '../ui';
import { createDatabase, createNotebook, createPage } from '../../features/actions';
import { savePrefs } from '../../app/services';
import { search, type SearchHit } from '../../search/search';
import { openHit, kindIcon } from '../../features/search/openHit';

interface Item {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const t = useT();
  const open = useApp((s) => s.paletteOpen);
  const setOpen = useApp((s) => s.setPaletteOpen);
  const workspaceId = useApp((s) => s.workspaceId);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<{ id: string; title: string; icon: string | null }[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setQ('');
    setActive(0);
    void repos().pages.listRecentVisited(workspaceId, 6).then(setRecent);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open || !workspaceId || !q.trim()) {
      setHits([]);
      return;
    }
    let alive = true;
    const h = setTimeout(() => {
      void search(repos().db, q, { workspaceId, mode: 'fulltext', limit: 12 }).then((r) => alive && setHits(r));
    }, 80);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q, open, workspaceId]);

  const go = (route: Route) => () => useApp.getState().navigate(route);
  const items: Item[] = useMemo(() => {
    const actions: Item[] = [
      { id: 'new-page', group: t('cmd.actions'), label: t('cmd.newPage'), icon: <Plus className="size-4" />, run: () => void createPage() },
      { id: 'new-nb', group: t('cmd.actions'), label: t('cmd.newNotebook'), icon: <BookOpen className="size-4" />, run: () => void createNotebook() },
      { id: 'new-db', group: t('cmd.actions'), label: t('db.new'), icon: <Database className="size-4" />, run: () => void createDatabase() },
      { id: 'new-task', group: t('cmd.actions'), label: t('cmd.newTask'), icon: <CheckSquare className="size-4" />, run: go({ name: 'tasks' }) },
      {
        id: 'theme',
        group: t('cmd.actions'),
        label: t('cmd.toggleTheme'),
        icon: <Moon className="size-4" />,
        run: () => void savePrefs({ theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark' }),
      },
      { id: 'g-home', group: t('cmd.goto'), label: t('nav.home'), icon: <Home className="size-4" />, run: go({ name: 'home' }) },
      { id: 'g-nb', group: t('cmd.goto'), label: t('nav.notebooks'), icon: <BookOpen className="size-4" />, run: go({ name: 'notebooks' }) },
      { id: 'g-src', group: t('cmd.goto'), label: t('nav.sources'), icon: <Library className="size-4" />, run: go({ name: 'sources' }) },
      { id: 'g-db', group: t('cmd.goto'), label: t('nav.databases'), icon: <Database className="size-4" />, run: go({ name: 'databases' }) },
      { id: 'g-tasks', group: t('cmd.goto'), label: t('nav.tasks'), icon: <CheckSquare className="size-4" />, run: go({ name: 'tasks' }) },
      { id: 'g-graph', group: t('cmd.goto'), label: t('nav.graph'), icon: <Network className="size-4" />, run: go({ name: 'graph' }) },
      { id: 'g-fav', group: t('cmd.goto'), label: t('nav.favorites'), icon: <Star className="size-4" />, run: go({ name: 'favorites' }) },
      { id: 'g-trash', group: t('cmd.goto'), label: t('nav.trash'), icon: <Trash2 className="size-4" />, run: go({ name: 'trash' }) },
      { id: 'g-settings', group: t('cmd.goto'), label: t('nav.settings'), icon: <Settings className="size-4" />, run: go({ name: 'settings' }) },
    ];
    const needle = q.trim().toLocaleLowerCase();
    if (!needle) {
      return [
        ...recent.map((p) => ({
          id: 'r-' + p.id,
          group: t('home.recent'),
          label: p.title || t('common.untitled'),
          icon: <span className="text-[14px]">{p.icon ?? <FileText className="size-4" />}</span>,
          run: go({ name: 'page', id: p.id }),
        })),
        ...actions,
      ];
    }
    const matchedActions = actions.filter((a) => a.label.toLocaleLowerCase().includes(needle));
    const results: Item[] = hits.map((h) => ({
      id: `${h.kind}-${h.refId}`,
      group: t('cmd.pages'),
      label: h.title || t('common.untitled'),
      sub: t(`search.kind.${h.kind}`),
      icon: kindIcon(h.kind),
      run: () => openHit(h),
    }));
    return [
      ...results,
      ...matchedActions,
      { id: 'search-all', group: t('nav.search'), label: t('cmd.searchAll', { q }), icon: <Search className="size-4" />, run: go({ name: 'search', q }) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hits, recent, t]);

  useEffect(() => {
    setActive(0);
  }, [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const run = (it: Item) => {
    setOpen(false);
    it.run();
  };
  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-black/25 pt-[12vh] backdrop-blur-[1px]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-[620px] overflow-hidden rounded-xl border border-line bg-elevated shadow-pop animate-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('cmd.placeholder')}
            aria-label={t('cmd.placeholder')}
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && items[active]) {
                e.preventDefault();
                run(items[active]);
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5" role="listbox">
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{header}</div>}
                <button
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(it)}
                  className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm', i === active && 'bg-hover')}
                >
                  <span className="flex size-5 items-center justify-center text-muted">{it.icon}</span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.sub && <span className="text-xs text-faint">{it.sub}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
