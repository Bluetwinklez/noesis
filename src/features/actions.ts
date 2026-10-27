import { repos, useApp, wsId } from '../app/state';
import { reportError } from '../app/services';
import type { DocNode } from '../core/doc';

export async function createPage(parentId: string | null = null, title = '', content: DocNode | null = null) {
  try {
    const page = await repos().pages.create({ workspaceId: wsId(), parentId, title, content });
    useApp.getState().bump();
    useApp.getState().navigate({ name: 'page', id: page.id });
    return page;
  } catch (e) {
    reportError(e);
    return null;
  }
}

export async function createDatabase(parentId: string | null = null, title = 'Untitled database') {
  try {
    const page = await repos().databases.createDatabase(wsId(), title, parentId);
    useApp.getState().bump();
    useApp.getState().navigate({ name: 'page', id: page.id });
    return page;
  } catch (e) {
    reportError(e);
    return null;
  }
}

export async function createNotebook(title = '') {
  try {
    const nb = await repos().notebooks.create(wsId(), title);
    useApp.getState().bump();
    useApp.getState().navigate({ name: 'notebook', id: nb.id });
    return nb;
  } catch (e) {
    reportError(e);
    return null;
  }
}

export async function trashPage(id: string) {
  try {
    await repos().pages.trash(id);
    const st = useApp.getState();
    st.bump();
    if (st.route.name === 'page' && st.route.id === id) st.navigate({ name: 'home' }, { replace: true });
    st.toast('Moved to trash', 'info', {
      label: 'Undo',
      run: async () => {
        await repos().pages.restore(id);
        useApp.getState().bump();
      },
    });
  } catch (e) {
    reportError(e);
  }
}

export async function toggleFavorite(id: string, current: boolean) {
  await repos().pages.updateMeta(id, { is_favorite: current ? 0 : 1 });
  useApp.getState().bump();
}

export async function togglePinned(id: string, current: boolean) {
  await repos().pages.updateMeta(id, { is_pinned: current ? 0 : 1 });
  useApp.getState().bump();
}
