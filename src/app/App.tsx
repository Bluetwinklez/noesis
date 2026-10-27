import { lazy, Suspense, useEffect } from 'react';
import { useApp } from './state';
import { Sidebar } from '../components/shell/Sidebar';
import { TopBar } from '../components/shell/TopBar';
import { CommandPalette } from '../components/shell/CommandPalette';
import { ToastHost, ConsentModal } from '../components/shell/Overlays';
import { DialogHost, Spinner } from '../components/ui';
import { useT } from '../i18n';
import { createPage } from '../features/actions';
import { savePrefs } from './services';
import { HomePage } from '../features/home/HomePage';
import { AiPreviewHost } from '../features/ai/AiPreview';
import { UpdateBanner } from '../components/shell/UpdateBanner';

// The editor (Tiptap/ProseMirror) and first-run flow are the heaviest modules; keep them out of the startup chunk.
const PageView = lazy(() => import('../features/pages/PageView').then((m) => ({ default: m.PageView })));
const Onboarding = lazy(() => import('../features/onboarding/Onboarding').then((m) => ({ default: m.Onboarding })));
const NotesPage = lazy(() => import('../features/pages/NotesPage'));
const WorkspacePage = lazy(() => import('../features/pages/WorkspacePage'));
const NotebooksPage = lazy(() => import('../features/notebooks/NotebooksPage'));
const NotebookView = lazy(() => import('../features/notebooks/NotebookView'));
const SourcesPage = lazy(() => import('../features/sources/SourcesPage'));
const DatabasesPage = lazy(() => import('../features/databases/DatabasesPage'));
const TasksPage = lazy(() => import('../features/tasks/TasksPage'));
const GraphPage = lazy(() => import('../features/graph/GraphPage'));
const SearchPage = lazy(() => import('../features/search/SearchPage'));
const FavoritesPage = lazy(() => import('../features/pages/FavoritesPage'));
const TrashPage = lazy(() => import('../features/pages/TrashPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));

function RouteView() {
  const route = useApp((s) => s.route);
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'workspace':
      return <WorkspacePage />;
    case 'notes':
      return <NotesPage />;
    case 'page':
      return <PageView key={route.id} id={route.id} />;
    case 'notebooks':
      return <NotebooksPage />;
    case 'notebook':
      return <NotebookView key={route.id} id={route.id} />;
    case 'sources':
      return <SourcesPage />;
    case 'databases':
      return <DatabasesPage />;
    case 'tasks':
      return <TasksPage />;
    case 'graph':
      return <GraphPage />;
    case 'search':
      return <SearchPage initial={route.q} />;
    case 'favorites':
      return <FavoritesPage />;
    case 'trash':
      return <TrashPage />;
    case 'settings':
      return <SettingsPage section={route.section} />;
  }
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        st.setPaletteOpen(!st.paletteOpen);
      } else if (mod && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void createPage();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        st.navigate({ name: 'search' });
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        void savePrefs({ sidebarCollapsed: !st.prefs.sidebarCollapsed });
      } else if (mod && e.key === ',') {
        e.preventDefault();
        st.navigate({ name: 'settings' });
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void savePrefs({ theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark' });
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        st.goBack();
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        st.goForward();
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) useApp.getState().goBack();
      if (e.button === 4) useApp.getState().goForward();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);
}

export function App() {
  const t = useT();
  const workspaceId = useApp((s) => s.workspaceId);
  const onboarded = useApp((s) => s.prefs.onboarded);
  useGlobalShortcuts();

  if (!workspaceId || !onboarded)
    return (
      <>
        <Suspense fallback={null}>
          <Onboarding />
        </Suspense>
        <DialogHost labels={{ ok: 'OK', cancel: t('common.cancel') }} />
      </>
    );

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <TopBar />
        <div className="min-h-0 flex-1 overflow-y-auto" id="main-scroll">
          <Suspense
            fallback={
              <div className="flex h-40 items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <RouteView />
          </Suspense>
        </div>
      </main>
      <CommandPalette />
      <ToastHost />
      <UpdateBanner />
      <ConsentModal />
      <AiPreviewHost />
      <DialogHost labels={{ ok: 'OK', cancel: t('common.cancel') }} />
    </div>
  );
}
