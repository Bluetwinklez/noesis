import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { Maximize2, Network, Search, Sparkles, X } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT, type MessageKey } from '../../i18n';
import { Button, EmptyState, IconButton, Spinner, useAsync, cx } from '../../components/ui';
import { buildGraph, type EdgeKind, type GraphNode, type NodeKind } from './graphData';
import { cosine, localHashEmbed } from '../../search/vectors';

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { kind: EdgeKind };

const KIND_COLOR: Record<NodeKind, string> = {
  page: '#6366f1',
  database: '#0ea5e9',
  source: '#f59e0b',
  tag: '#10b981',
  notebook: '#ec4899',
};
const EDGE_LABEL: Record<EdgeKind, MessageKey> = {
  link: 'graph.edge.link',
  tag: 'graph.edge.tag',
  source: 'graph.edge.source',
  semantic: 'graph.edge.semantic',
  parent: 'page.subpages',
};

export default function GraphPage() {
  const t = useT();
  const version = useApp((s) => s.version);
  const navigate = useApp((s) => s.navigate);
  const { data, loading } = useAsync(() => buildGraph(repos().db, wsId()), [version]);
  const [filters, setFilters] = useState<Record<NodeKind, boolean>>({ page: true, database: true, source: true, tag: true, notebook: true });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [suggestions, setSuggestions] = useState<{ a: GraphNode; b: GraphNode; score: number }[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const simRef = useRef<{ nodes: SimNode[]; links: SimLink[] } | null>(null);
  const hoverRef = useRef<SimNode | null>(null);
  const drawRef = useRef<() => void>(() => {});

  const filtered = useMemo(() => {
    if (!data) return null;
    const nodes = data.nodes.filter((n) => filters[n.kind]);
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [data, filters]);

  useEffect(() => {
    if (!filtered || !canvasRef.current || !wrapRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const prev = new Map((simRef.current?.nodes ?? []).map((n) => [n.id, n]));
    const nodes: SimNode[] = filtered.nodes.map((n) => ({ ...n, x: prev.get(n.id)?.x, y: prev.get(n.id)?.y }));
    const links: SimLink[] = filtered.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind }));
    simRef.current = { nodes, links };
    const big = nodes.length > 800;
    const sim = forceSimulation<SimNode>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance((l) => (l.kind === 'tag' ? 40 : 70)).strength(0.5))
      .force('charge', forceManyBody().strength(big ? -30 : -120).distanceMax(400))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<SimNode>((d) => 6 + Math.sqrt(d.degree) * 2))
      .alphaDecay(big ? 0.05 : 0.025);

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      // ResizeObserver can deliver a final callback after the page has unmounted.
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      if (!view.current.x && !view.current.y) view.current = { x: r.width / 2, y: r.height / 2, k: 1 };
      draw();
    };
    const css = getComputedStyle(document.documentElement);
    const draw = () => {
      const { x, y, k } = view.current;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(x, y);
      ctx.scale(k, k);
      const q = query.trim().toLowerCase();
      const focus = selected ?? hoverRef.current;
      const neighbors = new Set<string>();
      if (focus) for (const l of links) {
        const s = (l.source as SimNode).id;
        const tId = (l.target as SimNode).id;
        if (s === focus.id) neighbors.add(tId);
        if (tId === focus.id) neighbors.add(s);
      }
      // Viewport culling keeps large graphs responsive.
      const minX = -x / k - 50, maxX = (w - x) / k + 50, minY = -y / k - 50, maxY = (h - y) / k + 50;
      const inView = (n: SimNode) => n.x! > minX && n.x! < maxX && n.y! > minY && n.y! < maxY;
      ctx.lineWidth = 1 / k;
      for (const l of links) {
        const s = l.source as SimNode;
        const tt = l.target as SimNode;
        if (!inView(s) && !inView(tt)) continue;
        const hl = focus && (s.id === focus.id || tt.id === focus.id);
        ctx.strokeStyle = hl ? KIND_COLOR[focus!.kind] : l.kind === 'semantic' ? 'rgba(236,72,153,.35)' : css.getPropertyValue('--border-strong');
        if (l.kind === 'semantic' || l.kind === 'parent') ctx.setLineDash([4 / k, 3 / k]);
        else ctx.setLineDash([]);
        ctx.globalAlpha = focus && !hl ? 0.25 : 1;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(tt.x!, tt.y!);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of nodes) {
        if (!inView(n)) continue;
        const r = 4 + Math.sqrt(n.degree) * 1.8;
        const match = q && n.label.toLowerCase().includes(q);
        const dim = (focus && n.id !== focus.id && !neighbors.has(n.id)) || (q && !match);
        ctx.globalAlpha = dim ? 0.2 : 1;
        ctx.fillStyle = KIND_COLOR[n.kind];
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx.fill();
        if (n.id === selected?.id || match) {
          ctx.lineWidth = 2 / k;
          ctx.strokeStyle = css.getPropertyValue('--text');
          ctx.stroke();
        }
        if (k > 0.7 || n.degree > 3 || n.id === focus?.id || neighbors.has(n.id) || match) {
          ctx.fillStyle = css.getPropertyValue('--text');
          ctx.font = `${12 / Math.max(k, 0.8)}px Segoe UI, sans-serif`;
          ctx.fillText(n.label.length > 32 ? n.label.slice(0, 31) + '…' : n.label, n.x! + r + 3, n.y! + 4);
        }
      }
      ctx.globalAlpha = 1;
    };
    drawRef.current = draw;
    sim.on('tick', draw);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current);

    const toWorld = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left - view.current.x) / view.current.k, y: (e.clientY - r.top - view.current.y) / view.current.k };
    };
    const hit = (e: { clientX: number; clientY: number }) => {
      const p = toWorld(e);
      let best: SimNode | null = null;
      let bd = Infinity;
      for (const n of nodes) {
        const d = (n.x! - p.x) ** 2 + (n.y! - p.y) ** 2;
        const r = 6 + Math.sqrt(n.degree) * 2;
        if (d < r * r * 2 && d < bd) (best = n), (bd = d);
      }
      return best;
    };
    let drag: { node: SimNode | null; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const n = hit(e);
      drag = { node: n, sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
      if (n) {
        n.fx = n.x;
        n.fy = n.y;
        sim.alphaTarget(0.2).restart();
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag) {
        const h = hit(e);
        if (h !== hoverRef.current) {
          hoverRef.current = h;
          canvas.style.cursor = h ? 'pointer' : 'grab';
          draw();
        }
        return;
      }
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
      if (drag.node) {
        const p = toWorld(e);
        drag.node.fx = p.x;
        drag.node.fy = p.y;
      } else {
        view.current.x = drag.vx + e.clientX - drag.sx;
        view.current.y = drag.vy + e.clientY - drag.sy;
        draw();
      }
    };
    const up = () => {
      if (drag?.node) {
        drag.node.fx = null;
        drag.node.fy = null;
        sim.alphaTarget(0);
        if (!drag.moved) setSelected(drag.node);
      } else if (drag && !drag.moved) setSelected(null);
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const k2 = Math.min(4, Math.max(0.1, view.current.k * Math.exp(-e.deltaY * 0.0015)));
      view.current.x = mx - ((mx - view.current.x) * k2) / view.current.k;
      view.current.y = my - ((my - view.current.y) * k2) / view.current.k;
      view.current.k = k2;
      draw();
    };
    const dbl = (e: MouseEvent) => {
      const n = hit(e);
      if (n) open(n);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', dbl);
    return () => {
      sim.stop();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', dbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  useEffect(() => {
    drawRef.current();
  }, [query, selected]);

  const open = (n: GraphNode) => {
    if (n.kind === 'page' || n.kind === 'database') navigate({ name: 'page', id: n.refId });
    else if (n.kind === 'notebook') navigate({ name: 'notebook', id: n.refId });
    else if (n.kind === 'source') navigate({ name: 'sources', id: n.refId });
    else if (n.kind === 'tag') navigate({ name: 'notes' });
  };

  const fit = () => {
    const nodes = simRef.current?.nodes ?? [];
    if (!nodes.length || !wrapRef.current) return;
    const xs = nodes.map((n) => n.x!);
    const ys = nodes.map((n) => n.y!);
    const r = wrapRef.current.getBoundingClientRect();
    const w = Math.max(...xs) - Math.min(...xs) + 100;
    const h = Math.max(...ys) - Math.min(...ys) + 100;
    const k = Math.min(2, Math.min(r.width / w, r.height / h));
    view.current = { k, x: r.width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * k, y: r.height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * k };
    drawRef.current();
  };

  const focusSearch = () => {
    const q = query.trim().toLowerCase();
    const n = simRef.current?.nodes.find((x) => x.label.toLowerCase().includes(q));
    if (!n || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    view.current = { k: 1.5, x: r.width / 2 - n.x! * 1.5, y: r.height / 2 - n.y! * 1.5 };
    setSelected(n);
  };

  const suggest = async () => {
    const pages = await repos().db.all<{ id: string; title: string; content_text: string }>(
      "SELECT id, title, content_text FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND kind = 'page' LIMIT 400",
      [wsId()],
    );
    const vecs = pages.map((p) => ({ p, v: localHashEmbed(`${p.title}\n${p.content_text.slice(0, 4000)}`) }));
    const existing = new Set((data?.edges ?? []).map((e) => [e.source, e.target].sort().join('|')));
    const rejected = new Set((await repos().db.all<{ from_id: string; to_id: string }>("SELECT from_id, to_id FROM semantic_links WHERE status = 'rejected'")).map((r) => [r.from_id, r.to_id].sort().join('|')));
    const out: { a: GraphNode; b: GraphNode; score: number }[] = [];
    for (let i = 0; i < vecs.length; i++)
      for (let j = i + 1; j < vecs.length; j++) {
        const s = cosine(vecs[i].v, vecs[j].v);
        const key = [`page:${vecs[i].p.id}`, `page:${vecs[j].p.id}`].sort().join('|');
        if (s > 0.3 && !existing.has(key) && !rejected.has([vecs[i].p.id, vecs[j].p.id].sort().join('|')))
          out.push({ a: data!.nodes.find((n) => n.id === `page:${vecs[i].p.id}`)!, b: data!.nodes.find((n) => n.id === `page:${vecs[j].p.id}`)!, score: s });
      }
    setSuggestions(out.filter((x) => x.a && x.b).sort((a, b) => b.score - a.score).slice(0, 10));
  };

  const decide = async (s: { a: GraphNode; b: GraphNode; score: number }, approve: boolean) => {
    await repos().links.suggest('page', s.a.refId, 'page', s.b.refId, s.score);
    const link = (await repos().links.forItem('page', s.a.refId)).find((l) => l.to_id === s.b.refId);
    if (link) await repos().links.setStatus(link.id, approve ? 'approved' : 'rejected');
    setSuggestions((cur) => cur!.filter((x) => x !== s));
    if (approve) useApp.getState().bump();
  };

  const selEdges = useMemo(() => {
    if (!selected || !data) return [];
    return data.edges
      .filter((e) => e.source === selected.id || e.target === selected.id)
      .map((e) => ({ kind: e.kind, other: data.nodes.find((n) => n.id === (e.source === selected.id ? e.target : e.source))! }));
  }, [selected, data]);

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <div className="absolute left-4 right-4 top-3 z-10 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-elevated/95 px-2 shadow-sm backdrop-blur">
            <Search className="size-4 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && focusSearch()}
              placeholder={t('graph.search')}
              aria-label={t('graph.search')}
              className="h-8 w-48 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-elevated/95 p-1 shadow-sm backdrop-blur">
            {(['page', 'database', 'source', 'notebook', 'tag'] as NodeKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setFilters({ ...filters, [k]: !filters[k] })}
                aria-pressed={filters[k]}
                className={cx('flex items-center gap-1.5 rounded-md px-2 py-1 text-xs', filters[k] ? 'bg-hover text-fg' : 'text-faint')}
              >
                <span className="size-2.5 rounded-full" style={{ background: KIND_COLOR[k] }} />
                {t(k === 'page' ? 'graph.pages' : k === 'database' ? 'nav.databases' : k === 'source' ? 'graph.sources' : k === 'tag' ? 'graph.tags' : 'graph.notebooks')}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => void suggest()}>
            {t('graph.suggest')}
          </Button>
          <IconButton label={t('graph.fit')} onClick={fit} className="border border-line bg-elevated">
            <Maximize2 className="size-4" />
          </IconButton>
        </div>
        <div ref={wrapRef} className="h-full w-full">
          {loading && !data ? (
            <div className="flex h-full items-center justify-center"><Spinner /></div>
          ) : data && data.nodes.length === 0 ? (
            <EmptyState icon={<Network className="size-5" />} title={t('graph.title')} body={t('graph.empty')} />
          ) : (
            <canvas ref={canvasRef} role="img" aria-label={t('graph.title')} className="block cursor-grab touch-none" />
          )}
        </div>
      </div>
      {(selected || suggestions) && (
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-elevated p-4">
          {selected && (
            <div className="mb-6">
              <div className="mb-1 flex items-start gap-2">
                <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: KIND_COLOR[selected.kind] }} />
                <div className="flex-1 font-semibold">{selected.label}</div>
                <IconButton size="sm" label={t('common.close')} onClick={() => setSelected(null)}>
                  <X className="size-3.5" />
                </IconButton>
              </div>
              <div className="mb-3 text-xs text-faint">{t('graph.connections', { n: selEdges.length })}</div>
              <Button size="sm" variant="primary" onClick={() => open(selected)}>
                {t('common.open')}
              </Button>
              <ul className="mt-4 space-y-1">
                {selEdges.map((e, i) => (
                  <li key={i}>
                    <button className="w-full rounded-md px-2 py-1 text-left text-sm hover:bg-hover" onClick={() => setSelected(simRef.current!.nodes.find((n) => n.id === e.other.id) ?? null)}>
                      <span className="text-xs text-faint">{t(EDGE_LABEL[e.kind])} · </span>
                      {e.other.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {suggestions && (
            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-faint">
                {t('graph.suggestions')}
                <IconButton size="sm" label={t('common.close')} onClick={() => setSuggestions(null)}>
                  <X className="size-3.5" />
                </IconButton>
              </div>
              {!suggestions.length && <p className="text-sm text-muted">{t('graph.noSuggestions')}</p>}
              {suggestions.map((s, i) => (
                <div key={i} className="mb-2 rounded-lg border border-line p-2 text-sm">
                  <div className="truncate">{s.a.label}</div>
                  <div className="truncate text-muted">↔ {s.b.label}</div>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="flex-1 text-xs text-faint">{Math.round(s.score * 100)}%</span>
                    <Button size="sm" onClick={() => void decide(s, true)}>
                      {t('graph.approve')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void decide(s, false)}>
                      {t('graph.reject')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
