import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BookOpen,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  Database,
  FileText,
  Files,
  Home,
  Library,
  MoreHorizontal,
  Network,
  Pin,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  LayoutGrid,
  Copy,
  Archive,
  Check,
} from 'lucide-react';
import { useApp, repos, type Route } from '../../app/state';
import { useT } from '../../i18n';
import { cx, IconButton, MenuButton, Popover, MenuList, useAsync, Kbd, type MenuItem } from '../ui';
import { createPage, toggleFavorite, togglePinned, trashPage } from '../../features/actions';
import { savePrefs, setWorkspace, reportError } from '../../app/services';
import type { PageMeta } from '../../core/types';
import { clamp } from '../../lib/util';

function NavItem({ icon, label, route, active, shortcut }: { icon: ReactNode; label: string; route: Route; active: boolean; shortcut?: string }) {
  const navigate = useApp((s) => s.navigate);
  return (
    <button
      onClick={() => navigate(route)}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors',
        active ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg',
      )}
    >
      <span className={cx('flex size-4 items-center justify-center', active && 'text-accent')}>{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {shortcut && <span className="hidden text-[11px] text-faint group-hover:inline">{shortcut}</span>}
    </button>
  );
}

interface TreeNode extends PageMeta {
  children: TreeNode[];
}

function buildTree(pages: PageMeta[]): TreeNode[] {
  const map = new Map<string, TreeNode>(pages.map((p) => [p.id, { ...p, children: [] }]));
  const roots: TreeNode[] = [];
  for (const n of map.values()) {
    const parent = n.parent_id ? map.get(n.parent_id) : null;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

function PageRow({ node, depth, expanded, toggle }: { node: TreeNode; depth: number; expanded: Set<string>; toggle: (id: string) => void }) {
  const t = useT();
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const bump = useApp((s) => s.bump);
  const active = route.name === 'page' && route.id === node.id;
  const open = expanded.has(node.id);
  const [dropMode, setDropMode] = useState<null | 'inside' | 'before'>(null);
  const menu = (): MenuItem[] => [
    { label: t('page.addSubpage'), icon: <Plus className="size-3.5" />, onSelect: () => void createPage(node.id) },
    { label: node.is_favorite ? t('page.unfavorite') : t('page.favorite'), icon: <Star className="size-3.5" />, onSelect: () => void toggleFavorite(node.id, !!node.is_favorite) },
    { label: node.is_pinned ? t('page.unpin') : t('page.pin'), icon: <Pin className="size-3.5" />, onSelect: () => void togglePinned(node.id, !!node.is_pinned) },
    {
      label: t('common.duplicate'),
      icon: <Copy className="size-3.5" />,
      onSelect: async () => {
        const p = await repos().pages.duplicate(node.id);
        bump();
        navigate({ name: 'page', id: p.id });
      },
    },
    {
      label: t('page.archive'),
      icon: <Archive className="size-3.5" />,
      onSelect: async () => {
        await repos().pages.setArchived(node.id, true);
        bump();
      },
    },
    { separator: true, label: '' },
    { label: t('page.moveToTrash'), icon: <Trash2 className="size-3.5" />, danger: true, onSelect: () => void trashPage(node.id) },
  ];
  return (
    <>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-noesis-page', node.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-noesis-page')) return;
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setDropMode(e.clientY - r.top < r.height * 0.3 ? 'before' : 'inside');
        }}
        onDragLeave={() => setDropMode(null)}
        onDrop={async (e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('application/x-noesis-page');
          const mode = dropMode;
          setDropMode(null);
          if (!id || id === node.id) return;
          try {
            if (mode === 'before') await repos().pages.move(id, node.parent_id, node.sort_order);
            else {
              await repos().pages.move(id, node.id);
              if (!open) toggle(node.id);
            }
            bump();
          } catch (err) {
            reportError(err);
          }
        }}
        className={cx(
          'group relative flex h-[28px] cursor-pointer items-center gap-1 rounded-md pr-1 text-[13.5px]',
          active ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg',
          dropMode === 'inside' && 'ring-2 ring-accent ring-inset',
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => navigate({ name: 'page', id: node.id })}
        role="treeitem"
        aria-expanded={node.children.length ? open : undefined}
        aria-selected={active}
      >
        {dropMode === 'before' && <div className="absolute inset-x-1 -top-px h-0.5 rounded bg-accent" />}
        <button
          aria-label={open ? 'Collapse' : 'Expand'}
          className="flex size-5 shrink-0 items-center justify-center rounded text-faint hover:bg-active"
          onClick={(e) => {
            e.stopPropagation();
            toggle(node.id);
          }}
        >
          {node.children.length ? open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" /> : <span className="size-1 rounded-full bg-faint/60" />}
        </button>
        <span className="w-5 shrink-0 text-center text-[14px] leading-none">
          {node.icon ?? (node.kind === 'database' ? <Database className="mx-auto size-3.5" /> : <FileText className="mx-auto size-3.5" />)}
        </span>
        <span className="flex-1 truncate">{node.title || t('common.untitled')}</span>
        <span className="hidden items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
          <MenuButton items={menu} label="Page actions" className="size-5">
            <MoreHorizontal className="size-3.5" />
          </MenuButton>
          <IconButton
            size="sm"
            className="size-5"
            label={t('page.addSubpage')}
            onClick={() => {
              if (!open) toggle(node.id);
              void createPage(node.id);
            }}
          >
            <Plus className="size-3.5" />
          </IconButton>
        </span>
      </div>
      {open && node.children.map((c) => <PageRow key={c.id} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} />)}
    </>
  );
}

function WorkspaceSwitcher() {
  const t = useT();
  const workspaceId = useApp((s) => s.workspaceId);
  const version = useApp((s) => s.version);
  const { data: list } = useAsync(() => repos().workspaces.list(), [version]);
  const ws = list?.find((w) => w.id === workspaceId);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const items: MenuItem[] = [
    ...(list ?? []).map((w) => ({
      label: w.name,
      icon: <span>{w.icon ?? '◆'}</span>,
      checked: w.id === workspaceId,
      onSelect: () => void setWorkspace(w.id),
    })),
    { separator: true, label: '' },
    { label: t('settings.workspaces'), icon: <Settings className="size-3.5" />, onSelect: () => useApp.getState().navigate({ name: 'settings', section: 'workspaces' }) },
  ];
  return (
    <>
      <button ref={btn} onClick={() => setOpen(!open)} className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 hover:bg-hover">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-strong text-[12px] font-bold text-white">
          {ws?.icon ?? ws?.name?.[0]?.toUpperCase() ?? 'N'}
        </span>
        <span className="truncate text-[14px] font-semibold">{ws?.name ?? 'Noesis'}</span>
        <ChevronDown className="size-3.5 shrink-0 text-faint" />
      </button>
      <Popover anchor={btn.current} open={open} onClose={close}>
        <MenuList items={items} onClose={close} />
      </Popover>
    </>
  );
}

export function Sidebar() {
  const t = useT();
  const route = useApp((s) => s.route);
  const prefs = useApp((s) => s.prefs);
  const workspaceId = useApp((s) => s.workspaceId);
  const version = useApp((s) => s.version);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const { data: pages } = useAsync(async () => (workspaceId ? repos().pages.listTree(workspaceId) : []), [workspaceId, version]);
  const tree = useMemo(() => buildTree(pages ?? []), [pages]);
  const pinned = useMemo(() => (pages ?? []).filter((p) => p.is_pinned), [pages]);
  const favorites = useMemo(() => (pages ?? []).filter((p) => p.is_favorite), [pages]);
  const toggle = useCallback((id: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);
  const width = prefs.sidebarWidth;

  // Auto-expand ancestors of the active page.
  const activeId = route.name === 'page' ? route.id : null;
  useMemo(() => {
    if (!activeId || !pages) return;
    const byId = new Map(pages.map((p) => [p.id, p]));
    let cur = byId.get(activeId)?.parent_id;
    const add: string[] = [];
    while (cur) {
      add.push(cur);
      cur = byId.get(cur)?.parent_id ?? null;
    }
    if (add.some((id) => !expanded.has(id))) setExpanded((s) => new Set([...s, ...add]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, pages]);

  const onResize = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => useApp.setState({ prefs: { ...useApp.getState().prefs, sidebarWidth: clamp(startW + ev.clientX - startX, 200, 480) } });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void savePrefs({ sidebarWidth: useApp.getState().prefs.sidebarWidth });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (prefs.sidebarCollapsed) return null;
  const is = (n: Route['name']) => route.name === n;

  return (
    <aside className="relative flex shrink-0 flex-col border-r border-line bg-sidebar" style={{ width }} aria-label="Sidebar">
      <div className="flex items-center gap-1 px-2 pt-2">
        <WorkspaceSwitcher />
        <IconButton label={`${t('nav.collapse')} (Ctrl+\\)`} onClick={() => void savePrefs({ sidebarCollapsed: true })}>
          <ChevronsLeft className="size-4" />
        </IconButton>
      </div>
      <div className="px-2 pb-1 pt-1">
        <button
          onClick={() => useApp.getState().setPaletteOpen(true)}
          className="mb-1 flex h-8 w-full items-center gap-2 rounded-md border border-line bg-elevated/60 px-2 text-[13px] text-faint hover:text-muted"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{t('cmd.placeholder')}</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <NavItem icon={<Home className="size-4" />} label={t('nav.home')} route={{ name: 'home' }} active={is('home')} />
        <NavItem icon={<LayoutGrid className="size-4" />} label={t('nav.workspace')} route={{ name: 'workspace' }} active={is('workspace')} />
        <NavItem icon={<Files className="size-4" />} label={t('nav.notes')} route={{ name: 'notes' }} active={is('notes')} />
        <NavItem icon={<BookOpen className="size-4" />} label={t('nav.notebooks')} route={{ name: 'notebooks' }} active={is('notebooks') || is('notebook')} />
        <NavItem icon={<Library className="size-4" />} label={t('nav.sources')} route={{ name: 'sources' }} active={is('sources')} />
        <NavItem icon={<Database className="size-4" />} label={t('nav.databases')} route={{ name: 'databases' }} active={is('databases')} />
        <NavItem icon={<CheckSquare className="size-4" />} label={t('nav.tasks')} route={{ name: 'tasks' }} active={is('tasks')} />
        <NavItem icon={<Network className="size-4" />} label={t('nav.graph')} route={{ name: 'graph' }} active={is('graph')} />
        <NavItem icon={<Search className="size-4" />} label={t('nav.search')} route={{ name: 'search' }} active={is('search')} shortcut="Ctrl⇧F" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" role="tree" aria-label={t('nav.pages')}>
        {pinned.length > 0 && (
          <Section title={t('nav.pinned')}>
            {pinned.map((p) => (
              <ShortcutRow key={p.id} page={p} icon={<Pin className="size-3" />} />
            ))}
          </Section>
        )}
        {favorites.length > 0 && (
          <Section title={t('nav.favorites')}>
            {favorites.map((p) => (
              <ShortcutRow key={p.id} page={p} icon={<Star className="size-3" />} />
            ))}
          </Section>
        )}
        <Section
          title={t('nav.pages')}
          action={
            <IconButton size="sm" label={t('nav.newPage')} onClick={() => void createPage()}>
              <Plus className="size-3.5" />
            </IconButton>
          }
          onDropRoot={async (id) => {
            try {
              await repos().pages.move(id, null);
              useApp.getState().bump();
            } catch (e) {
              reportError(e);
            }
          }}
        >
          {tree.map((n) => (
            <PageRow key={n.id} node={n} depth={0} expanded={expanded} toggle={toggle} />
          ))}
          <button onClick={() => void createPage()} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-faint hover:bg-hover hover:text-muted">
            <Plus className="size-3.5" /> {t('nav.newPage')}
          </button>
        </Section>
      </div>

      <div className="border-t border-line px-2 py-1.5">
        <NavItem icon={<Star className="size-4" />} label={t('nav.favorites')} route={{ name: 'favorites' }} active={is('favorites')} />
        <NavItem icon={<Trash2 className="size-4" />} label={t('nav.trash')} route={{ name: 'trash' }} active={is('trash')} />
        <NavItem icon={<Settings className="size-4" />} label={t('nav.settings')} route={{ name: 'settings' }} active={is('settings')} shortcut="Ctrl ," />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onResize}
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/30"
      />
    </aside>
  );
}

function Section({ title, children, action, onDropRoot }: { title: string; children: ReactNode; action?: ReactNode; onDropRoot?: (id: string) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className="mt-3">
      <div
        className={cx('group flex h-6 items-center justify-between rounded px-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint', over && 'bg-accent-soft')}
        onDragOver={(e) => {
          if (onDropRoot && e.dataTransfer.types.includes('application/x-noesis-page')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const id = e.dataTransfer.getData('application/x-noesis-page');
          if (id && onDropRoot) onDropRoot(id);
        }}
      >
        <span>{title}</span>
        <span className="opacity-0 group-hover:opacity-100">{action}</span>
      </div>
      {children}
    </div>
  );
}

function ShortcutRow({ page, icon }: { page: PageMeta; icon: ReactNode }) {
  const t = useT();
  const route = useApp((s) => s.route);
  const active = route.name === 'page' && route.id === page.id;
  return (
    <button
      onClick={() => useApp.getState().navigate({ name: 'page', id: page.id })}
      className={cx('flex h-[28px] w-full items-center gap-2 rounded-md px-2 text-[13.5px]', active ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg')}
    >
      <span className="w-4 text-center text-faint">{page.icon ?? icon}</span>
      <span className="flex-1 truncate text-left">{page.title || t('common.untitled')}</span>
      {active && <Check className="size-3 text-accent" />}
    </button>
  );
}
