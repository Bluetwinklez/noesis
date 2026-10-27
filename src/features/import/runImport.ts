import { blobStore, pickFiles } from '../../lib/platform';
import { repos, useApp, wsId } from '../../app/state';
import { importWorkspace } from '../../import/importer';
import { t } from '../../i18n';

/** Picks a Notion export zip, an Obsidian vault zip or loose .md/.csv files and imports them. */
export async function runImport(): Promise<void> {
  const files = await pickFiles('.zip,.md,.markdown,.csv,.png,.jpg,.jpeg,.gif,.webp,.svg', true);
  if (!files.length) return;
  const app = useApp.getState();
  app.toast(t('import.running'), 'info');
  const r = await importWorkspace(
    repos(),
    wsId(),
    files.map((f) => ({ path: f.name, bytes: f.bytes })),
    { blobs: blobStore, rootTitle: (source) => t(source === 'notion' ? 'import.rootNotion' : source === 'obsidian' ? 'import.rootObsidian' : 'import.rootGeneric') },
  );
  app.bump();
  app.toast(t('import.done', { pages: r.pages, databases: r.databases, images: r.images }), 'success');
  app.navigate({ name: 'page', id: r.rootId });
}
