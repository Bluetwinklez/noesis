import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { repos, useApp } from '../../app/state';
import { AGENT_ACTIONS, type AgentAction, type AgentActivityEntry } from '../../core/repos/agent-activity';
import { useT, type MessageKey } from '../../i18n';
import { Button, IconButton, Select, Spinner } from '../../components/ui';
import { relativeTime } from '../../lib/util';

const PAGE_SIZE = 25;

export function AgentActivityPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const workspaceId = useApp((s) => s.workspaceId);
  const version = useApp((s) => s.version);
  const lang = useApp((s) => s.lang);
  const navigate = useApp((s) => s.navigate);

  const [clientFilter, setClientFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<AgentAction | ''>('');
  const [clients, setClients] = useState<string[]>([]);
  const [items, setItems] = useState<AgentActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadedLimitRef = useRef(PAGE_SIZE);
  const reqIdRef = useRef(0);
  const prevFilterKeyRef = useRef('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setClientFilter('');
    setActionFilter('');
  }, [workspaceId]);

  const filterKey = `${workspaceId ?? ''}|${clientFilter}|${actionFilter}`;

  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    const reqId = ++reqIdRef.current;
    const filterChanged = prevFilterKeyRef.current !== filterKey;
    prevFilterKeyRef.current = filterKey;
    if (filterChanged) {
      loadedLimitRef.current = PAGE_SIZE;
      setLoading(true);
    }
    const limit = loadedLimitRef.current;

    Promise.all([
      repos().activity.listFiltered(workspaceId, {
        client: clientFilter || undefined,
        action: actionFilter || undefined,
        limit,
        offset: 0,
      }),
      repos().activity.listClients(workspaceId),
    ]).then(
      ([page, clientList]) => {
        if (!alive || reqId !== reqIdRef.current) return;
        setItems(page.items);
        setTotal(page.total);
        setHasMore(page.hasMore);
        setClients(clientList);
        setLoading(false);
        setLoadingMore(false);
      },
      () => {
        if (!alive || reqId !== reqIdRef.current) return;
        setLoading(false);
        setLoadingMore(false);
      },
    );

    return () => {
      alive = false;
    };
  }, [workspaceId, filterKey, clientFilter, actionFilter, version]);

  const loadMore = async () => {
    if (!workspaceId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const reqId = ++reqIdRef.current;
    try {
      const page = await repos().activity.listFiltered(workspaceId, {
        client: clientFilter || undefined,
        action: actionFilter || undefined,
        limit: PAGE_SIZE,
        offset: items.length,
      });
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev, ...page.items.filter((x) => !seen.has(x.id))];
        loadedLimitRef.current = Math.max(PAGE_SIZE, merged.length);
        return merged;
      });
      setTotal(page.total);
      setHasMore(page.hasMore);
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  };

  const clientOptions = useMemo(() => {
    const names = clientFilter && !clients.includes(clientFilter) ? [clientFilter, ...clients] : clients;
    return [
      { value: '', label: t('graph.allAgents') },
      ...names.map((c) => ({ value: c, label: c })),
    ];
  }, [clients, clientFilter, t]);

  const actionOptions = useMemo(
    () => [
      { value: '' as AgentAction | '', label: t('graph.allActions') },
      ...AGENT_ACTIONS.map((a) => ({
        value: a as AgentAction | '',
        label: t(`graph.action.${a}` as MessageKey),
      })),
    ],
    [t],
  );

  const openEntry = (entry: AgentActivityEntry) => {
    if (entry.page_id) navigate({ name: 'page', id: entry.page_id });
    else if (entry.task_id) navigate({ name: 'tasks' });
  };

  const hasFilters = !!(clientFilter || actionFilter);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">{t('graph.activityTimeline')}</div>
          {!loading && total > 0 && <div className="text-xs text-muted">{t('graph.activityCount', { n: total })}</div>}
        </div>
        <IconButton size="sm" label={t('common.close')} onClick={onClose}>
          <X className="size-3.5" />
        </IconButton>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Select
          value={clientFilter}
          onChange={setClientFilter}
          options={clientOptions}
          ariaLabel={t('graph.filterAgent')}
          className="h-8 w-full min-w-0 text-xs"
        />
        <Select
          value={actionFilter}
          onChange={setActionFilter}
          options={actionOptions}
          ariaLabel={t('graph.filterAction')}
          className="h-8 w-full min-w-0 text-xs"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <p className="py-2 text-sm text-muted">{hasFilters ? t('graph.noMatchingActivity') : t('graph.noActivity')}</p>
      ) : (
        <>
          <ul className="space-y-1" aria-label={t('graph.activityTimeline')}>
            {items.map((a) => {
              const targetTitle = a.title !== null ? a.title || t('common.untitled') : t('graph.deleted');
              const actionLabel = t(`graph.action.${a.action}` as MessageKey);
              const clickable = !!(a.page_id || a.task_id);
              const inner = (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium text-fg">{a.client}</span>
                    <span className="shrink-0 text-[11px] text-faint">{relativeTime(a.created_at, lang)}</span>
                  </div>
                  <div className="truncate text-sm text-muted">
                    <span className="text-xs text-faint">{actionLabel} · </span>
                    <span className={clickable ? 'text-fg' : undefined}>{targetTitle}</span>
                  </div>
                </>
              );
              return (
                <li key={a.id}>
                  {clickable ? (
                    <button
                      type="button"
                      onClick={() => openEntry(a)}
                      className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className="rounded-md px-2 py-1.5">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <Button size="sm" variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                {t('graph.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
