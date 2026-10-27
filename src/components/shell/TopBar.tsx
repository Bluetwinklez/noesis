import { ArrowLeft, ArrowRight, ChevronRight, ChevronsRight, CloudOff, Moon, Sun, Check, Loader2, AlertTriangle } from 'lucide-react';
import { create } from 'zustand';
import { useApp, repos } from '../../app/state';
import { useT, type MessageKey } from '../../i18n';
import { IconButton, useAsync } from '../ui';
import { savePrefs } from '../../app/services';

/** Editor save status shown in the top bar. */
export const useSaveStatus = create<{ status: 'idle' | 'saving' | 'saved' | 'error' }>(() => ({ status: 'idle' }));

const SECTION_LABEL: Record<string, MessageKey> = {
  home: 'nav.home',
  workspace: 'nav.workspace',
  notes: 'nav.notes',
  notebooks: 'nav.notebooks',
  notebook: 'nav.notebooks',
  sources: 'nav.sources',
  databases: 'nav.databases',
  tasks: 'nav.tasks',
  graph: 'nav.graph',
  search: 'nav.search',
  favorites: 'nav.favorites',
  trash: 'nav.trash',
  settings: 'nav.settings',
};

function Breadcrumbs() {
  const t = useT();
  const route = useApp((s) => s.route);
  const version = useApp((s) => s.version);
  const navigate = useApp((s) => s.navigate);
  const { data: chain } = useAsync(async () => (route.name === 'page' ? repos().pages.ancestors(route.id) : []), [route, version]);
  const { data: nb } = useAsync(async () => (route.name === 'notebook' ? repos().notebooks.get(route.id) : undefined), [route, version]);
  if (route.name === 'page') {
    return (
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5 text-[13.5px]">
        {(chain ?? []).map((p, i, arr) => (
          <span key={p.id} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-faint" />}
            <button
              onClick={() => navigate({ name: 'page', id: p.id })}
              className={`max-w-[200px] truncate rounded px-1.5 py-0.5 hover:bg-hover ${i === arr.length - 1 ? 'text-fg' : 'text-muted'}`}
            >
              {p.icon ? `${p.icon} ` : ''}
              {p.title || t('common.untitled')}
            </button>
          </span>
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-0.5 text-[13.5px]">
      <button onClick={() => route.name === 'notebook' && navigate({ name: 'notebooks' })} className={`rounded px-1.5 py-0.5 ${route.name === 'notebook' ? 'text-muted hover:bg-hover' : 'text-fg'}`}>
        {t(SECTION_LABEL[route.name] ?? 'nav.home')}
      </button>
      {nb && (
        <>
          <ChevronRight className="size-3.5 text-faint" />
          <span className="px-1.5 text-fg">{nb.title}</span>
        </>
      )}
    </nav>
  );
}

function SaveIndicator() {
  const t = useT();
  const status = useSaveStatus((s) => s.status);
  const route = useApp((s) => s.route);
  if (route.name !== 'page' || status === 'idle') return null;
  return (
    <span className="flex items-center gap-1 text-xs text-faint" aria-live="polite">
      {status === 'saving' && <Loader2 className="size-3 animate-spin" />}
      {status === 'saved' && <Check className="size-3" />}
      {status === 'error' && <AlertTriangle className="size-3 text-danger" />}
      {status === 'saving' ? t('page.saving') : status === 'saved' ? t('page.saved') : t('page.saveError')}
    </span>
  );
}

export function TopBar() {
  const t = useT();
  const { back, forward, goBack, goForward, online, prefs } = useApp();
  const dark = document.documentElement.classList.contains('dark');
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-transparent px-2">
      {prefs.sidebarCollapsed && (
        <IconButton label={t('nav.expand')} onClick={() => void savePrefs({ sidebarCollapsed: false })}>
          <ChevronsRight className="size-4" />
        </IconButton>
      )}
      <IconButton label={`${t('nav.back')} (Alt+←)`} onClick={goBack} disabled={!back.length}>
        <ArrowLeft className="size-4" />
      </IconButton>
      <IconButton label={`${t('nav.forward')} (Alt+→)`} onClick={goForward} disabled={!forward.length}>
        <ArrowRight className="size-4" />
      </IconButton>
      <div className="ml-1 min-w-0 flex-1">
        <Breadcrumbs />
      </div>
      <SaveIndicator />
      {!online && (
        <span className="ml-2 flex items-center gap-1.5 rounded-md bg-warning/12 px-2 py-1 text-xs text-warning" title={t('common.offline')}>
          <CloudOff className="size-3.5" /> Offline
        </span>
      )}
      <IconButton label={t('cmd.toggleTheme')} onClick={() => void savePrefs({ theme: dark ? 'light' : 'dark' })}>
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </IconButton>
    </header>
  );
}
