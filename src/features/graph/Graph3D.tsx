import { useEffect, useMemo, useRef } from 'react';
import ForceGraph3D, { type ConfigOptions, type ForceGraph3DInstance } from '3d-force-graph';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Object3D,
} from 'three';
import type { EdgeKind, GraphEdge, GraphNode, NodeKind } from './graphData';

type Node3D = GraphNode & { x?: number; y?: number; z?: number };
type Link3D = { source: string | Node3D; target: string | Node3D; kind: EdgeKind };
// The library's constructor is not generic; this gives node callbacks our node type.
const Graph3DCtor = ForceGraph3D as unknown as new (el: HTMLElement, opts?: ConfigOptions) => ForceGraph3DInstance<Node3D, Link3D>;

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  colors: Record<NodeKind, string>;
  legend: { kind: NodeKind; label: string; count: number }[];
  selectedId: string | null;
  label: string;
  onSelect: (node: GraphNode | null) => void;
}

/** Link colours by relationship; agent and repository links stand out, structure stays quiet. */
const EDGE_COLOR: Record<EdgeKind, string> = {
  link: '#8b93ff',
  tag: '#34d399',
  source: '#fbbf24',
  semantic: '#f472b6',
  parent: '#64748b',
  agent: '#f87171',
  mention: '#94a3b8',
};

interface Parts {
  solid: MeshBasicMaterial;
  glow: SpriteMaterial;
  labelMat: SpriteMaterial;
  important: boolean;
}

let glowTexture: CanvasTexture | null = null;
/** Soft round halo, shared by every node. */
function halo(): CanvasTexture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new CanvasTexture(c);
  return glowTexture;
}

/** Text on a dark pill, drawn once per node into a sprite that always faces the camera. */
function makeLabel(text: string): { sprite: Sprite; material: SpriteMaterial } {
  const shown = text.length > 30 ? `${text.slice(0, 29)}…` : text;
  const scale = 2;
  const font = `600 ${13 * scale}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(shown).width) + 16 * scale;
  const h = 24 * scale;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,12,26,0.72)';
  g.beginPath();
  g.roundRect(0, 0, w, h, h / 2);
  g.fill();
  g.font = font;
  g.fillStyle = '#f1f5f9';
  g.textBaseline = 'middle';
  g.fillText(shown, 8 * scale, h / 2 + 1);
  const material = new SpriteMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false });
  const sprite = new Sprite(material);
  sprite.scale.set(w / (scale * 3.2), h / (scale * 3.2), 1);
  return { sprite, material };
}

/** A faint sphere of stars around the graph, so empty space reads as depth. */
function starfield(): Points {
  const n = 700;
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = 700 + Math.random() * 500;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos.push(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph));
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return new Points(geo, new PointsMaterial({ color: 0x9fb3ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
}

/** WebGL view of the same graph. Loaded on demand: three.js is only fetched when 3D is turned on. */
export default function Graph3D({ nodes, edges, colors, legend, selectedId, label, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance<Node3D, Link3D> | null>(null);
  const partsRef = useRef(new Map<string, Parts>());
  const hoverRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
    for (const e of edges) {
      add(e.source, e.target);
      add(e.target, e.source);
    }
    return m;
  }, [edges]);
  const neighborsRef = useRef(neighbors);
  neighborsRef.current = neighbors;

  // Dim everything except the focused node (hovered, else selected) and its neighbours.
  const focusRef = useRef<() => void>(() => {});
  focusRef.current = () => {
    const focus = hoverRef.current ?? selectedRef.current;
    const near = focus ? neighborsRef.current.get(focus) : null;
    for (const [id, p] of partsRef.current) {
      const on = !focus || id === focus || !!near?.has(id);
      p.solid.opacity = on ? 1 : 0.14;
      p.glow.opacity = on ? (id === focus ? 0.95 : 0.55) : 0.04;
      p.labelMat.opacity = on && (p.important || !!focus) ? 1 : 0;
    }
    graphRef.current?.linkOpacity(focus ? 0.5 : 0.28);
  };

  useEffect(() => {
    const el = wrapRef.current!;
    const parts = partsRef.current;
    const graph = new Graph3DCtor(el, { controlType: 'orbit' })
      .backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      .nodeId('id')
      .nodeLabel(() => '')
      .nodeThreeObject((n) => {
        const color = new Color(colors[n.kind]);
        const agent = n.kind === 'agent';
        const r = (agent ? 5.5 : 2.6) + Math.sqrt(n.degree) * 1.5;
        const geometry = agent ? new OctahedronGeometry(r * 1.15) : n.kind === 'repo' ? new BoxGeometry(r * 1.4, r * 1.4, r * 1.4) : new SphereGeometry(r, 20, 14);
        const solid = new MeshBasicMaterial({ color, transparent: true });
        const group = new Group();
        group.add(new Mesh(geometry, solid));
        const glow = new SpriteMaterial({ map: halo(), color, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.55 });
        const haloSprite = new Sprite(glow);
        haloSprite.scale.set(r * (agent ? 8 : 5.5), r * (agent ? 8 : 5.5), 1);
        group.add(haloSprite);
        const { sprite, material } = makeLabel(n.label);
        sprite.position.set(0, -(r + 6), 0);
        group.add(sprite);
        const important = agent || n.degree >= 3;
        material.opacity = important ? 1 : 0;
        parts.set(n.id, { solid, glow, labelMat: material, important });
        return group as Object3D;
      })
      .nodeThreeObjectExtend(false)
      .linkColor((l) => EDGE_COLOR[l.kind])
      .linkOpacity(0.28)
      .linkWidth(0.35)
      .linkCurvature((l) => (l.kind === 'agent' || l.kind === 'mention' ? 0.18 : 0))
      .linkDirectionalParticleWidth(1.8)
      .linkDirectionalParticleSpeed(0.006)
      .onNodeHover((n) => {
        hoverRef.current = n?.id ?? null;
        el.style.cursor = n ? 'pointer' : 'grab';
        focusRef.current();
      })
      // Frame the whole graph once the layout settles, unless the user is looking at a selection.
      .onEngineStop(() => {
        if (!selectedRef.current) graphRef.current?.zoomToFit(800, 70);
      })
      .onNodeClick((n) => onSelectRef.current(n))
      .onBackgroundClick(() => onSelectRef.current(null));
    graph.cameraPosition({ z: 260 });
    graph.scene().add(starfield());
    const controls = graph.controls() as { autoRotate: boolean; autoRotateSpeed: number };
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    graphRef.current = graph;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) graph.width(r.width).height(r.height);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      graph._destructor();
      graphRef.current = null;
      parts.clear();
    };
    // Node objects are built from the colours once; the data effect below refreshes only the graph data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New pages and links written by agents arrive here live; known nodes keep their position.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const prev = new Map(graph.graphData().nodes.map((n) => [n.id, n]));
    graph.graphData({
      nodes: nodes.map((n) => Object.assign(prev.get(n.id) ?? {}, n)),
      links: edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind })),
    });
    const alive = new Set(nodes.map((n) => n.id));
    for (const id of partsRef.current.keys()) if (!alive.has(id)) partsRef.current.delete(id);
    // Re-frame when the set of nodes changes; new agent writes pull the camera back to show everything.
    if (!selectedRef.current) graph.d3ReheatSimulation();
    focusRef.current();
  }, [nodes, edges]);

  // Highlight the selection's links with moving particles, pause the slow orbit and fly the camera to it.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    (graph.controls() as { autoRotate: boolean }).autoRotate = !selectedId;
    const touches = (l: Link3D) => [l.source, l.target].some((x) => (typeof x === 'string' ? x : x.id) === selectedId);
    graph
      .linkDirectionalParticles((l) => (selectedId && touches(l) ? 4 : 0))
      .linkWidth((l) => (selectedId && touches(l) ? 1.4 : 0.35));
    focusRef.current();
    const n = graph.graphData().nodes.find((x) => x.id === selectedId);
    if (n && n.x !== undefined) {
      const d = 1 + 120 / (Math.hypot(n.x, n.y ?? 0, n.z ?? 0) || 1);
      graph.cameraPosition({ x: n.x * d, y: (n.y ?? 0) * d, z: (n.z ?? 0) * d }, { x: n.x, y: n.y ?? 0, z: n.z ?? 0 }, 900);
    }
  }, [selectedId]);

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 38%, #172042 0%, #0a0f24 55%, #04060f 100%)' }}
    >
      <div ref={wrapRef} role="img" aria-label={label} data-testid="graph-3d" className="h-full w-full cursor-grab" />
      <ul
        aria-label={`${label}: legend`}
        className="pointer-events-none absolute bottom-4 left-4 space-y-1 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs text-slate-200 backdrop-blur"
      >
        {legend.map((l) => (
          <li key={l.kind} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: colors[l.kind], boxShadow: `0 0 8px ${colors[l.kind]}` }} />
            <span className="flex-1">{l.label}</span>
            <span className="tabular-nums text-slate-400">{l.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
