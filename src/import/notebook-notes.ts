import type { ExportedNotebook } from '../export/exporter';
import type { Repos } from '../core/store';
import type { NotebookNoteKind } from '../core/types';
import { readSourceCoverage } from '../ai/studio-context';

export type ImportedNotebook = ExportedNotebook;
const KINDS: NotebookNoteKind[] = ['note', 'summary', 'study_guide', 'flashcards', 'quiz', 'faq', 'timeline', 'briefing', 'comparison'];
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Files are user-editable. Keep imported records inside the repository contracts. */
export function parseNotebookNotes(raw: unknown): ImportedNotebook[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(object).slice(0, 1000).map((nb) => ({
    title: String(nb.title ?? '').slice(0, 500),
    description: String(nb.description ?? '').slice(0, 100_000),
    sources: (Array.isArray(nb.sources) ? nb.sources : []).filter(object).filter((s) => typeof s.ref === 'string').map((s) => ({ ref: String(s.ref), selected: s.selected !== false })),
    notes: (Array.isArray(nb.notes) ? nb.notes : []).filter(object).slice(0, 10_000).map((n) => ({
      kind: KINDS.find((k) => k === n.kind) ?? 'note',
      title: String(n.title ?? '').slice(0, 500),
      content_md: typeof n.content_md === 'string' ? n.content_md : '',
      data: object(n.data) ? n.data : {},
      // Old chunk ids and offsets are not portable across re-extraction. Preserve the
      // source-level link; never invent an exact quotation in the new database.
      citations: (Array.isArray(n.citations) ? n.citations : []).filter(object)
        .filter((c) => typeof c.sourceId === 'string' && Number.isInteger(c.n) && Number(c.n) > 0)
        .map((c) => ({ n: Number(c.n), sourceId: String(c.sourceId), sourceTitle: String(c.sourceTitle ?? ''), chunkId: -1, pageNumber: null, charStart: 0, charEnd: 0, excerpt: '' })),
    })),
  }));
}

/** Call after the import pipeline has registered the new source ids. */
export async function restoreNotebookNotes(repos: Repos, workspaceId: string, notebooks: ImportedNotebook[], sourceIds: Map<string, string>) {
  for (const item of notebooks) {
    const nb = await repos.notebooks.create(workspaceId, item.title, item.description);
    for (const s of item.sources) {
      const id = sourceIds.get(s.ref);
      if (id) { await repos.notebooks.addSource(nb.id, id); await repos.notebooks.setSelected(nb.id, id, s.selected); }
    }
    // Repository reads newest first. Insert oldest first to preserve display order.
    for (const note of [...item.notes].reverse()) {
      const data = { ...note.data };
      if (Array.isArray(data.coverage)) data.coverage = readSourceCoverage(data.coverage).map((c) => ({ ...c, sourceId: sourceIds.get(c.sourceId) ?? c.sourceId }));
      const citations = note.citations.flatMap((c) => { const id = sourceIds.get(c.sourceId); return id ? [{ ...c, sourceId: id }] : []; });
      await repos.notebooks.addNote(nb.id, note.kind, note.title, note.content_md, data, citations);
    }
  }
}
