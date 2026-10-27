import { blobStore, pickFiles, saveFile } from '../../lib/platform';
import { repos, useApp, wsId } from '../../app/state';
import { ingestion } from '../../app/services';
import { importWorkspace, type PendingSource } from '../../import/importer';
import { exportWorkspace } from '../../export/exporter';
import { t } from '../../i18n';

/** Picks a Notion export zip, an Obsidian vault zip, a Noesis export or loose .md/.csv files and imports them. */
export async function runImport(): Promise<void> {
  const files = await pickFiles('.zip,.md,.markdown,.csv,.png,.jpg,.jpeg,.gif,.webp,.svg', true);
  if (!files.length) return;
  const app = useApp.getState();
  app.toast(t('import.running'), 'info');
  const r = await importWorkspace(
    repos(),
    wsId(),
    files.map((f) => ({ path: f.name, bytes: f.bytes })),
    {
      blobs: blobStore,
      rootTitle: (source) =>
        t(source === 'notion' ? 'import.rootNotion' : source === 'obsidian' ? 'import.rootObsidian' : source === 'noesis' ? 'import.rootNoesis' : 'import.rootGeneric'),
    },
  );
  const sources = await restoreSources(r.sources);
  app.bump();
  app.toast(t('import.done', { pages: r.pages, databases: r.databases, images: r.images }), 'success');
  if (r.tasks || sources) app.toast(t('import.doneExtra', { tasks: r.tasks, sources }), 'success');
  app.navigate({ name: 'page', id: r.rootId });
}

/** Re-adds the research sources of a Noesis export; processing (extraction, indexing) runs in the background. */
async function restoreSources(list: PendingSource[]): Promise<number> {
  const pipe = ingestion();
  let n = 0;
  for (const s of list) {
    const added = s.file
      ? await pipe.importFile(wsId(), { name: s.file.path.split('/').pop() ?? s.title, bytes: s.file.bytes })
      : /^https?:\/\//i.test(s.origin) && (s.kind === 'url' || s.kind === 'youtube')
        ? await pipe.importUrl(wsId(), s.origin)
        : s.text
          ? await pipe.importText(wsId(), s.title, s.text)
          : null;
    if (!added) continue;
    n++;
    if (added.title !== s.title && s.title) await repos().sources.rename(added.id, s.title);
    if (added.status !== 'error') void pipe.process(added.id).then(() => useApp.getState().bump(), () => undefined);
  }
  return n;
}

/** Saves the whole workspace as an open-format zip (Markdown, CSV, files) that also imports back. */
export async function runExportAll(): Promise<void> {
  const app = useApp.getState();
  const ws = (await repos().workspaces.list()).find((w) => w.id === wsId());
  const { bytes, manifest } = await exportWorkspace(repos(), wsId(), blobStore, { appVersion: import.meta.env.VITE_APP_VERSION });
  const name = `Noesis ${ws?.name ?? 'workspace'} ${new Date().toISOString().slice(0, 10)}.zip`;
  if (await saveFile(name, bytes, [{ name: 'Zip', extensions: ['zip'] }]))
    app.toast(t('export.done', { pages: manifest.counts.pages, databases: manifest.counts.databases, files: manifest.counts.files }), 'success');
}
