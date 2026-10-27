import type { Database } from '../../core/db/driver';

export type NodeKind = 'page' | 'database' | 'source' | 'tag' | 'notebook';
export type EdgeKind = 'link' | 'tag' | 'source' | 'semantic' | 'parent';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  refId: string;
  degree: number;
}
export interface GraphEdge {
  source: string;
  target: string;
  kind: EdgeKind;
}

/** Builds the knowledge graph from explicit relationships only (plus approved semantic links). */
export async function buildGraph(db: Database, workspaceId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (kind: NodeKind, refId: string, label: string) => {
    const id = `${kind === 'database' ? 'page' : kind}:${refId}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, refId, degree: 0 });
    return id;
  };
  const pages = await db.all<{ id: string; title: string; kind: string; icon: string | null; parent_id: string | null }>(
    'SELECT id, title, kind, icon, parent_id FROM pages WHERE workspace_id = ? AND deleted_at IS NULL',
    [workspaceId],
  );
  const live = new Set(pages.map((p) => p.id));
  for (const p of pages) add(p.kind === 'database' ? 'database' : 'page', p.id, `${p.icon ? p.icon + ' ' : ''}${p.title || 'Untitled'}`);
  for (const p of pages) if (p.parent_id && live.has(p.parent_id)) edges.push({ source: `page:${p.parent_id}`, target: `page:${p.id}`, kind: 'parent' });

  const links = await db.all<{ source_id: string; target_id: string }>(
    'SELECT l.source_id, l.target_id FROM page_links l JOIN pages p ON p.id = l.source_id WHERE p.workspace_id = ?',
    [workspaceId],
  );
  for (const l of links) if (live.has(l.source_id) && live.has(l.target_id)) edges.push({ source: `page:${l.source_id}`, target: `page:${l.target_id}`, kind: 'link' });

  const tags = await db.all<{ page_id: string; tag_id: string; name: string }>(
    'SELECT pt.page_id, t.id AS tag_id, t.name FROM page_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.workspace_id = ?',
    [workspaceId],
  );
  for (const t of tags) {
    if (!live.has(t.page_id)) continue;
    const tagId = add('tag', t.tag_id, `#${t.name}`);
    edges.push({ source: `page:${t.page_id}`, target: tagId, kind: 'tag' });
  }

  const nbs = await db.all<{ id: string; title: string }>('SELECT id, title FROM notebooks WHERE workspace_id = ?', [workspaceId]);
  for (const n of nbs) add('notebook', n.id, `📓 ${n.title}`);
  const ns = await db.all<{ notebook_id: string; source_id: string; title: string }>(
    'SELECT ns.notebook_id, ns.source_id, s.title FROM notebook_sources ns JOIN sources s ON s.id = ns.source_id WHERE s.workspace_id = ?',
    [workspaceId],
  );
  for (const x of ns) {
    const sid = add('source', x.source_id, `📄 ${x.title}`);
    edges.push({ source: `notebook:${x.notebook_id}`, target: sid, kind: 'source' });
  }

  const sem = await db.all<{ from_kind: string; from_id: string; to_kind: string; to_id: string }>("SELECT * FROM semantic_links WHERE status = 'approved'");
  for (const s of sem) {
    const a = `${s.from_kind}:${s.from_id}`;
    const b = `${s.to_kind}:${s.to_id}`;
    if (nodes.has(a) && nodes.has(b)) edges.push({ source: a, target: b, kind: 'semantic' });
  }
  for (const e of edges) {
    nodes.get(e.source)!.degree++;
    nodes.get(e.target)!.degree++;
  }
  return { nodes: [...nodes.values()], edges };
}
