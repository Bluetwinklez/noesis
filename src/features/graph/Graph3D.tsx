import { useEffect, useRef } from 'react';
import ForceGraph3D, { type ConfigOptions, type ForceGraph3DInstance } from '3d-force-graph';
import type { EdgeKind, GraphEdge, GraphNode, NodeKind } from './graphData';

type Node3D = GraphNode & { x?: number; y?: number; z?: number };
type Link3D = { source: string | Node3D; target: string | Node3D; kind: EdgeKind };
// The library's constructor is not generic; this gives node callbacks our node type.
const Graph3DCtor = ForceGraph3D as unknown as new (el: HTMLElement, opts?: ConfigOptions) => ForceGraph3DInstance<Node3D, Link3D>;

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  colors: Record<NodeKind, string>;
  selectedId: string | null;
  label: string;
  onSelect: (node: GraphNode | null) => void;
}

/** WebGL view of the same graph. Loaded on demand: three.js is only fetched when 3D is turned on. */
export default function Graph3D({ nodes, edges, colors, selectedId, label, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance<Node3D, Link3D> | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const el = wrapRef.current!;
    const graph = new Graph3DCtor(el, { controlType: 'orbit' })
      .backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      .nodeId('id')
      .nodeLabel((n) => n.label)
      .nodeVal((n) => 1 + n.degree)
      .nodeOpacity(0.9)
      .linkOpacity(0.35)
      .linkDirectionalParticleWidth(1.5)
      .onNodeClick((n) => onSelectRef.current(n))
      .onBackgroundClick(() => onSelectRef.current(null));
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
    };
  }, []);

  // New pages and links written by agents arrive here live; known nodes keep their position.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const prev = new Map(graph.graphData().nodes.map((n) => [n.id, n]));
    graph
      .nodeColor((n) => colors[n.kind])
      .graphData({
        nodes: nodes.map((n) => Object.assign(prev.get(n.id) ?? {}, n)),
        links: edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind })),
      });
  }, [nodes, edges, colors]);

  // Highlight the selection's links with moving particles and fly the camera to it.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const touches = (l: Link3D) => [l.source, l.target].some((x) => (typeof x === 'string' ? x : x.id) === selectedId);
    graph.linkDirectionalParticles((l) => (selectedId && touches(l) ? 3 : 0)).linkWidth((l) => (selectedId && touches(l) ? 1.5 : 0));
    const n = graph.graphData().nodes.find((x) => x.id === selectedId);
    if (n && n.x !== undefined) {
      const d = 1 + 120 / (Math.hypot(n.x, n.y ?? 0, n.z ?? 0) || 1);
      graph.cameraPosition({ x: n.x * d, y: (n.y ?? 0) * d, z: (n.z ?? 0) * d }, { x: n.x, y: n.y ?? 0, z: n.z ?? 0 }, 800);
    }
  }, [selectedId]);

  return <div ref={wrapRef} role="img" aria-label={label} data-testid="graph-3d" className="h-full w-full cursor-grab" />;
}
