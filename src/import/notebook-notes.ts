import type { ExportedNotebook } from '../export/exporter';
import type { Repos } from '../core/store';
import type { Citation, NotebookNoteKind } from '../core/types';
import { readSourceCoverage } from '../ai/studio-context';

export type ImportedNotebook = ExportedNotebook;
const KINDS: NotebookNoteKind[] = ['note', 'summary', 'study_guide', 'flashcards', 'quiz', 'faq', 'timeline', 'briefing', 'comparison'];
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function readCitations(raw: unknown): Citation[] {
  return (Array.isArray(raw) ? raw : []).filter(object).slice(0, 1000)
    .filter((c) => typeof c.sourceId === 'string' && Number.isInteger(c.n) && Number(c.n) > 0)
    .map((c) => ({ n: Number(c.n), sourceId: String(c.sourceId), sourceTitle: String(c.sourceTitle ?? ''), chunkId: -1, pageNumber: null, charStart: 0, charEnd: 0, excerpt: '' }));
}

/** Files are user-editable. Keep imported records inside the repository contracts. */
export function parseNotebookNotes(raw: unknown): ImportedNotebook[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(object).slice(0, 1000).map((nb) => ({
    title: String(nb.title ?? '').slice(0, 500),
    description: String(nb.description ?? '').slice(0, 100_000),
    sources: (Array.isArray(nb.sources) ? nb.sources : []).filter(object).slice(0, 10_000).filter((s) => typeof s.ref === 'string').map((s) => ({ ref: String(s.ref), selected: s.selected !== false })),
    messages: (Array.isArray(nb.messages) ? nb.messages : []).filter(object).slice(0, 10_000)
      .filter((m) => ['user', 'assistant', 'system'].includes(String(m.role))).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: typeof m.content === 'string' ? m.content : '',
        status: (['complete', 'error', 'cancelled'] as const).find((s) => s === m.status) ?? 'complete',
        citations: readCitations(m.citations),
        insufficient: m.role === 'assistant' && (m.insufficient === true || ((!m.status || m.status === 'complete') && readCitations(m.citations).length === 0)),
      })),
    notes: (Array.isArray(nb.notes) ? nb.notes : []).filter(object).slice(0, 10_000).map((n) => ({
      kind: KINDS.find((k) => k === n.kind) ?? 'note',
      title: String(n.title ?? '').slice(0, 500),
      content_md: typeof n.content_md === 'string' ? n.content_md : '',
      data: object(n.data) ? n.data : {},
      // Old chunk ids and offsets are not portable across re-extraction. Preserve the
      // source-level link; never invent an exact quotation in the new database.
      citations: readCitations(n.citations),
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
    for (const message of item.messages ?? []) {
      const citations = message.citations.flatMap((c) => { const id = sourceIds.get(c.sourceId); return id ? [{ ...c, sourceId: id }] : []; });
      await repos.notebooks.addMessage({ ...message, notebook_id: nb.id, citations, insufficient: message.insufficient || (message.role === 'assistant' && message.status === 'complete' && citations.length === 0) });
    }
  }
}
