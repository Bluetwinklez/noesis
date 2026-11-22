import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { useT } from '../../i18n';
import { Modal } from '../../components/ui';
import type { PageMeta } from '../../core/types';

function descendantSet(pages: readonly PageMeta[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.parent_id) continue;
    const list = childrenByParent.get(p.parent_id);
    if (list) list.push(p.id);
    else childrenByParent.set(p.parent_id, [p.id]);
  }
  const seen = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const childId of childrenByParent.get(id) ?? []) {
      if (!seen.has(childId)) {
        seen.add(childId);
        stack.push(childId);
      }
    }
  }
  return seen;
}

function parentPathLabel(page: PageMeta, byId: ReadonlyMap<string, PageMeta>, untitled: string): string {
  const parts: string[] = [];
  const seen = new Set<string>([page.id]);
  let cur = page.parent_id;
  while (cur && !seen.has(cur) && parts.length < 16) {
    seen.add(cur);
    const parent = byId.get(cur);
    if (!parent) break;
    parts.unshift(parent.title || untitled);
    cur = parent.parent_id;
  }
  return parts.join(' / ');
}

export function MergePageDialog({
  source,
  pages,
  onClose,
  onSelectTarget,
}: {
  source: PageMeta | null;
  pages: readonly PageMeta[];
  onClose: () => void;
  onSelectTarget: (source: PageMeta, target: PageMeta) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');

  useEffect(() => {
    setQuery('');
  }, [source?.id]);

  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);

  const candidates = useMemo(() => {
    if (!source) return [];
    const excluded = descendantSet(pages, source.id);
    const q = query.trim().toLowerCase();
    return pages
      .filter((p) => {
        if (p.kind !== 'page' || excluded.has(p.id)) return false;
        if (!q) return true;
        return (p.title || t('common.untitled')).toLowerCase().includes(q);
      })
      .slice(0, 50);
  }, [source, pages, query, t]);

  if (!source) return null;

  const sourceTitle = source.title || t('common.untitled');

  return (
    <Modal open onClose={onClose} title={t('page.mergeIntoTitle', { title: sourceTitle })} width={460}>
      <p className="mb-3 text-xs text-muted">{t('page.mergeIntoHint', { source: sourceTitle })}</p>
      <input
        data-autofocus
        aria-label={t('page.mergeSearchPlaceholder')}
        className="mb-2 h-9 w-full rounded-lg border border-line-strong bg-elevated px-3 text-sm outline-none focus:border-accent"
        placeholder={t('page.mergeSearchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {candidates.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted">{t('page.mergeNoTargets')}</p>
      ) : (
        <ul aria-label={t('page.mergeInto')} className="max-h-72 space-y-0.5 overflow-y-auto">
          {candidates.map((target) => {
            const path = parentPathLabel(target, byId, t('common.untitled'));
            return (
              <li key={target.id}>
                <button
                  type="button"
                  onClick={() => onSelectTarget(source, target)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center text-muted">
                    {target.icon ?? <FileText className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg">{target.title || t('common.untitled')}</span>
                    {path && <span className="block truncate text-[11px] text-faint">{path}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
