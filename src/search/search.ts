import type { Database, SqlValue } from '../core/db/driver';
import { toFtsQuery } from '../core/repos/search-index';
import type { SearchKind } from '../core/types';
import { cosine, localHashEmbed, LOCAL_EMBED_MODEL, rrf } from './vectors';

export type SearchMode = 'keyword' | 'fulltext' | 'semantic' | 'hybrid';

export interface SearchHit {
  kind: SearchKind;
  refId: string;
  parentId: string | null;
  title: string;
  snippet: string;
  score: number;
  /** For chunk hits: page number inside the source. */
  pageNumber?: number | null;
}

export interface SearchOptions {
  workspaceId: string;
  mode?: SearchMode;
  kinds?: SearchKind[];
  limit?: number;
  /** Query embedding from a provider model; local vectors are used otherwise. */
  embedQuery?: (text: string) => Promise<{ vector: number[]; model: string } | null>;
}

const MARK_OPEN = '\u0002';
const MARK_CLOSE = '\u0003';

interface FtsRow {
  kind: SearchKind;
  ref_id: string;
  parent_id: string;
  title: string;
  snip: string;
  rank: number;
}

function splitKinds(kinds?: SearchKind[]): { indexKinds: SearchKind[] | null; wantIndex: boolean; wantChunks: boolean } {
  if (!kinds?.length) return { indexKinds: null, wantIndex: true, wantChunks: true };
  const indexKinds = kinds.filter((k) => k !== 'chunk');
  return {
    indexKinds,
    wantIndex: indexKinds.length > 0,
    wantChunks: kinds.includes('chunk'),
  };
}

/** Keyword search on titles only (fast, prefix). */
async function keywordSearch(db: Database, q: string, o: SearchOptions): Promise<SearchHit[]> {
  const fts = toFtsQuery(q);
  if (!fts) return [];
  const { indexKinds, wantIndex } = splitKinds(o.kinds);
  if (!wantIndex) return [];
  const kindClause = indexKinds ? ` AND kind IN (${indexKinds.map(() => '?').join(',')})` : '';
  const params: SqlValue[] = [`title : (${fts})`, o.workspaceId, ...(indexKinds ?? []), o.limit ?? 30];
  const rows = await db.all<FtsRow>(
    `SELECT kind, ref_id, parent_id, title, snippet(search_index, 5, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 12) AS snip,
       bm25(search_index, 0, 0, 0, 0, 10.0, 0.0001) AS rank
     FROM search_index WHERE search_index MATCH ? AND workspace_id = ?${kindClause} ORDER BY rank LIMIT ?`,
    params,
  );
  return rows.map(toHit);
}

async function fullTextSearch(db: Database, q: string, o: SearchOptions): Promise<SearchHit[]> {
  const fts = toFtsQuery(q);
  if (!fts) return [];
  const limit = o.limit ?? 30;
  const { indexKinds, wantIndex, wantChunks } = splitKinds(o.kinds);
  const hits: SearchHit[] = [];
  if (wantIndex) {
    const kindClause = indexKinds ? ` AND kind IN (${indexKinds.map(() => '?').join(',')})` : '';
    const params: SqlValue[] = [fts, o.workspaceId, ...(indexKinds ?? []), limit];
    const rows = await db.all<FtsRow>(
      `SELECT kind, ref_id, parent_id, title, snippet(search_index, 5, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 16) AS snip,
         bm25(search_index, 0, 0, 0, 0, 5.0, 1.0) AS rank
       FROM search_index WHERE search_index MATCH ? AND workspace_id = ?${kindClause} ORDER BY rank LIMIT ?`,
      params,
    );
    hits.push(...rows.map(toHit));
  }
  if (wantChunks) {
    // Document passages: point straight at the matching location in a source.
    const chunkRows = await db.all<{ id: number; source_id: string; title: string; snip: string; rank: number; page_number: number | null }>(
      `SELECT c.id, c.source_id, s.title, c.page_number, snippet(chunks_fts, 0, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 16) AS snip,
         bm25(chunks_fts) AS rank
       FROM chunks_fts JOIN source_chunks c ON c.id = chunks_fts.rowid JOIN sources s ON s.id = c.source_id
       WHERE chunks_fts MATCH ? AND s.workspace_id = ? ORDER BY rank LIMIT ?`,
      [fts, o.workspaceId, limit],
    );
    for (const c of chunkRows) {
      hits.push({
        kind: 'chunk',
        refId: String(c.id),
        parentId: c.source_id,
        title: c.title,
        snippet: c.snip,
        score: -c.rank,
        pageNumber: c.page_number,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

/**
 * Local vectors for notes/rows/tasks are computed on demand; cache them by entity and
 * a content hash so repeated queries only re-embed what changed since the last search.
 */
const localVectorCache = new Map<string, { hash: number; vec: number[] }>();
const LOCAL_VECTOR_CACHE_MAX = 20_000;

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function cachedLocalVector(key: string, text: string): number[] {
  const hash = fnv1a(text);
  const hit = localVectorCache.get(key);
  if (hit && hit.hash === hash) return hit.vec;
  const vec = localHashEmbed(text);
  if (localVectorCache.size >= LOCAL_VECTOR_CACHE_MAX) localVectorCache.delete(localVectorCache.keys().next().value!);
  localVectorCache.set(key, { hash, vec });
  return vec;
}

async function semanticSearch(db: Database, q: string, o: SearchOptions): Promise<SearchHit[]> {
  const limit = o.limit ?? 30;
  const { indexKinds, wantIndex, wantChunks } = splitKinds(o.kinds);
  const provider = o.embedQuery ? await o.embedQuery(q).catch(() => null) : null;
  const localQ = localHashEmbed(q);
  const hits: SearchHit[] = [];

  if (wantChunks) {
    const chunks = await db.all<{ id: number; source_id: string; title: string; text: string; embedding: string | null; embedding_model: string | null; page_number: number | null }>(
      `SELECT c.id, c.source_id, s.title, c.text, c.embedding, s.embedding_model, c.page_number FROM source_chunks c
       JOIN sources s ON s.id = c.source_id WHERE s.workspace_id = ? AND s.status = 'ready'`,
      [o.workspaceId],
    );
    for (const c of chunks) {
      let score: number;
      if (provider && c.embedding && c.embedding_model === provider.model) score = cosine(provider.vector, JSON.parse(c.embedding));
      else if (c.embedding && c.embedding_model === LOCAL_EMBED_MODEL) score = cosine(localQ, JSON.parse(c.embedding));
      else score = cosine(localQ, cachedLocalVector(`chunk:${c.id}`, c.text));
      hits.push({ kind: 'chunk', refId: String(c.id), parentId: c.source_id, title: c.title, snippet: c.text.slice(0, 220), score, pageNumber: c.page_number });
    }
  }

  if (wantIndex) {
    // Notes and other entities are embedded on the fly with local vectors.
    const kindClause = indexKinds ? ` AND kind IN (${indexKinds.map(() => '?').join(',')})` : " AND kind != 'source'";
    const params: SqlValue[] = [o.workspaceId, ...(indexKinds ?? [])];
    const docs = await db.all<{ kind: SearchKind; ref_id: string; parent_id: string; title: string; body: string }>(
      `SELECT kind, ref_id, parent_id, title, body FROM search_index WHERE workspace_id = ?${kindClause}`,
      params,
    );
    for (const d of docs) {
      const score = cosine(localQ, cachedLocalVector(`${d.kind}:${d.ref_id}`, `${d.title}\n${d.title}\n${d.body.slice(0, 4000)}`));
      hits.push({ kind: d.kind, refId: d.ref_id, parentId: d.parent_id || null, title: d.title, snippet: d.body.slice(0, 220), score });
    }
  }
  return hits.filter((h) => h.score > 0.08).sort((a, b) => b.score - a.score).slice(0, limit);
}

function toHit(r: FtsRow): SearchHit {
  return { kind: r.kind, refId: r.ref_id, parentId: r.parent_id || null, title: r.title, snippet: r.snip, score: -r.rank };
}

export async function search(db: Database, query: string, options: SearchOptions): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const mode = options.mode ?? 'hybrid';
  let hits: SearchHit[];
  if (mode === 'keyword') hits = await keywordSearch(db, q, options);
  else if (mode === 'fulltext') hits = await fullTextSearch(db, q, options);
  else if (mode === 'semantic') hits = await semanticSearch(db, q, options);
  else {
    const [ft, sem] = await Promise.all([fullTextSearch(db, q, options), semanticSearch(db, q, options)]);
    const key = (h: SearchHit) => `${h.kind}:${h.refId}`;
    const all = new Map<string, SearchHit>();
    for (const h of [...sem, ...ft]) all.set(key(h), h);
    const fused = rrf([ft.map(key), sem.map(key)]);
    hits = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, score]) => ({ ...all.get(k)!, score }));
  }
  if (options.kinds?.length) hits = hits.filter((h) => options.kinds!.includes(h.kind));
  return hits.slice(0, options.limit ?? 30);
}

/** Splits a snippet with FTS markers into renderable segments. */
export function snippetSegments(snippet: string): { text: string; match: boolean }[] {
  const out: { text: string; match: boolean }[] = [];
  const re = new RegExp(`${MARK_OPEN}(.*?)${MARK_CLOSE}`, 'gs');
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    if (m.index! > last) out.push({ text: snippet.slice(last, m.index), match: false });
    out.push({ text: m[1], match: true });
    last = m.index! + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), match: false });
  return out;
}
