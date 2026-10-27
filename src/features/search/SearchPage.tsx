import { useEffect, useRef, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT, type MessageKey } from '../../i18n';
import { cx, EmptyState, Spinner, Tabs } from '../../components/ui';
import { search, snippetSegments, type SearchHit, type SearchMode } from '../../search/search';
import type { SearchKind } from '../../core/types';
import { kindIcon, openHit } from './openHit';
import { activeProvider } from '../../app/services';

const KINDS: SearchKind[] = ['page', 'row', 'task', 'notebook', 'note', 'source', 'chunk'];

export default function SearchPage({ initial }: { initial?: string }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const prefs = useApp((s) => s.prefs);
  const [q, setQ] = useState(initial ?? '');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const [kinds, setKinds] = useState<SearchKind[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    let alive = true;
    setBusy(true);
    const h = setTimeout(async () => {
      try {
        // Query embeddings only use a provider the user already allowed (never prompts while typing).
        const embedQuery =
          mode === 'semantic' || mode === 'hybrid'
            ? async (text: string) => {
                const p = await activeProvider();
                if (!p?.embed || !p.capabilities.embeddings || (p.isCloud && !prefs.cloudConsents.includes(p.id))) return null;
                return { vector: (await p.embed([text]))[0], model: p.config.embeddingModel };
              }
            : undefined;
        const r = await search(repos().db, q, { workspaceId: wsId(), mode, kinds, limit: 50, embedQuery });
        if (alive) {
          setHits(r);
          setActive(0);
        }
      } finally {
        if (alive) setBusy(false);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q, mode, kinds, version, prefs.cloudConsents]);

  return (
    <div className="mx-auto max-w-[860px] px-8 py-10">
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-line-strong bg-elevated px-4 shadow-sm focus-within:border-accent">
        <SearchIcon className="size-5 text-faint" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className="h-12 flex-1 bg-transparent text-base outline-none"
          onKeyDown={(e) => {
            if (!hits?.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') void openHit(hits[active]);
          }}
        />
        {busy && <Spinner />}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Tabs
          value={mode}
          onChange={setMode}
          tabs={(['keyword', 'fulltext', 'semantic', 'hybrid'] as SearchMode[]).map((m) => ({ value: m, label: t(`search.mode.${m}` as MessageKey) }))}
        />
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button
              key={k}
              aria-pressed={kinds.includes(k)}
              onClick={() => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])}
              className={cx('rounded-full border px-2.5 py-0.5 text-xs', kinds.includes(k) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-hover')}
            >
              {t(`search.kind.${k}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-5 text-xs text-faint">
        {t('search.hint')} {(mode === 'semantic' || mode === 'hybrid') && t('search.semanticNote')}
      </p>
      {hits === null ? (
        <EmptyState icon={<SearchIcon className="size-5" />} title={t('nav.search')} body={t('search.hint')} />
      ) : hits.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t('search.noResults', { q })}</p>
      ) : (
        <ul className="space-y-1" role="listbox">
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.refId}`}>
              <button
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => void openHit(h)}
                className={cx('flex w-full gap-3 rounded-lg px-3 py-2.5 text-left', i === active ? 'bg-hover' : '')}
              >
                <span className="mt-0.5 text-muted">{kindIcon(h.kind)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{h.title || t('common.untitled')}</span>
                    <span className="text-[11px] text-faint">
                      {t(`search.kind.${h.kind}` as MessageKey)}
                      {h.pageNumber ? ` · p. ${h.pageNumber}` : ''}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-[13px] text-muted">
                    {snippetSegments(h.snippet).map((s, j) =>
                      s.match ? (
                        <mark key={j} className="rounded bg-amber-300/50 px-0.5 text-fg dark:bg-amber-500/30">
                          {s.text}
                        </mark>
                      ) : (
                        <span key={j}>{s.text}</span>
                      ),
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
