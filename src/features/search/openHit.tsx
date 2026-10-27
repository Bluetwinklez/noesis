import { BookOpen, CheckSquare, Database, FileText, FileSearch, Library, StickyNote } from 'lucide-react';
import { repos, useApp } from '../../app/state';
import type { SearchHit } from '../../search/search';
import type { SearchKind } from '../../core/types';

export function kindIcon(kind: SearchKind) {
  switch (kind) {
    case 'page':
      return <FileText className="size-4" />;
    case 'row':
      return <Database className="size-4" />;
    case 'task':
      return <CheckSquare className="size-4" />;
    case 'notebook':
      return <BookOpen className="size-4" />;
    case 'note':
      return <StickyNote className="size-4" />;
    case 'source':
      return <Library className="size-4" />;
    case 'chunk':
      return <FileSearch className="size-4" />;
  }
}

/** Navigates to the place a search hit lives. */
export async function openHit(h: SearchHit) {
  const nav = useApp.getState().navigate;
  switch (h.kind) {
    case 'page':
      return nav({ name: 'page', id: h.refId });
    case 'row':
      return nav({ name: 'page', id: h.parentId! });
    case 'task':
      return nav({ name: 'tasks' });
    case 'notebook':
      return nav({ name: 'notebook', id: h.refId });
    case 'note':
      return nav({ name: 'notebook', id: h.parentId! });
    case 'source':
      return nav({ name: 'sources', id: h.refId });
    case 'chunk': {
      const c = await repos().db.get<{ char_start: number; char_end: number }>('SELECT char_start, char_end FROM source_chunks WHERE id = ?', [Number(h.refId)]);
      return nav({ name: 'sources', id: h.parentId!, highlight: c ? { start: c.char_start, end: c.char_end } : undefined });
    }
  }
}
