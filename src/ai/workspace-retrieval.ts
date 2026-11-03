import type { Database } from '../core/db/driver';
import { toFtsQuery } from '../core/repos/search-index';
import { chunkPages } from '../ingestion/chunker';
import { cosine, localHashEmbed, rrf, tokenizeWords } from '../search/vectors';
import { estimateTokens } from '../lib/util';
import type { AiProvider } from './types';
import { buildGroundedPrompt, noEvidenceMessage, resolveCitations, type RetrievedChunk } from './rag';

export interface WorkspaceEvidence {
  kind: 'page' | 'source';
  id: string;
  title: string;
  text: string;
  start: number;
  end: number;
  pageNumber: number | null;
  score: number;
}

/** Rank candidates from pages and notebook sources together; lexical matches must be real, not hash collisions. */
export function rankWorkspaceEvidence(query: string, candidates: Omit<WorkspaceEvidence, 'score'>[], limit = 8, budget = 6000): WorkspaceEvidence[] {
  const terms = [...new Set(tokenizeWords(query))];
  if (!terms.length) return [];
  const vector = localHashEmbed(query);
  const scored = candidates.map((candidate, index) => {
    const words = new Set(tokenizeWords(`${candidate.title} ${candidate.text}`));
    const hits = terms.filter((term) => [...words].some((word) => word.startsWith(term) || term.startsWith(word))).length;
    return { index, hits, similarity: cosine(vector, localHashEmbed(candidate.text)) };
  }).filter((candidate) => candidate.hits > 0);
  const lexical = [...scored].sort((a, b) => b.hits - a.hits).map((x) => x.index);
  const semantic = [...scored].sort((a, b) => b.similarity - a.similarity).map((x) => x.index);
  const scores = rrf([lexical, semantic]);
  let used = 0;
  const out: WorkspaceEvidence[] = [];
  for (const [index, score] of [...scores].sort((a, b) => b[1] - a[1])) {
    const candidate = candidates[index];
    const cost = estimateTokens(candidate.text) + 30;
    if (used + cost > budget) continue;
    used += cost;
    out.push({ ...candidate, score });
    if (out.length >= limit) break;
  }
  return out;
}

export async function retrieveWorkspaceEvidence(db: Database, workspaceId: string, query: string, signal?: AbortSignal): Promise<WorkspaceEvidence[]> {
  const fts = toFtsQuery(query, 'any');
  if (!fts) return [];
  signal?.throwIfAborted();
  const pages = await db.all<{ id: string; title: string; content_text: string }>(
    `SELECT p.id, p.title, p.content_text FROM search_index i JOIN pages p ON p.id = i.ref_id
     WHERE search_index MATCH ? AND i.kind = 'page' AND p.workspace_id = ? AND p.deleted_at IS NULL AND p.archived_at IS NULL ORDER BY bm25(search_index) LIMIT 80`, [fts, workspaceId]);
  const sources = await db.all<{ source_id: string; title: string; text: string; char_start: number; char_end: number; page_number: number | null }>(
    `SELECT c.source_id, s.title, c.text, c.char_start, c.char_end, c.page_number FROM chunks_fts
     JOIN source_chunks c ON c.id = chunks_fts.rowid JOIN sources s ON s.id = c.source_id
     WHERE chunks_fts MATCH ? AND s.workspace_id = ? AND s.status = 'ready'
       AND EXISTS (SELECT 1 FROM notebook_sources ns JOIN notebooks n ON n.id = ns.notebook_id WHERE ns.source_id = s.id AND n.workspace_id = ?)
     ORDER BY bm25(chunks_fts) LIMIT 80`, [fts, workspaceId, workspaceId]);
  signal?.throwIfAborted();
  const candidates: Omit<WorkspaceEvidence, 'score'>[] = sources.map((s) => ({ kind: 'source', id: s.source_id, title: s.title, text: s.text, start: s.char_start, end: s.char_end, pageNumber: s.page_number }));
  for (const page of pages) for (const part of chunkPages([{ text: page.content_text, pageNumber: null }]).chunks) {
    candidates.push({ kind: 'page', id: page.id, title: page.title, text: part.text, start: part.charStart, end: part.charEnd, pageNumber: null });
  }
  return rankWorkspaceEvidence(query, candidates);
}

export async function answerWorkspaceQuestion(db: Database, workspaceId: string, provider: AiProvider, question: string, lang: string, signal?: AbortSignal) {
  const evidence = await retrieveWorkspaceEvidence(db, workspaceId, question, signal);
  if (!evidence.length) return { text: noEvidenceMessage(lang), citations: [], insufficient: true, evidence };
  const chunks: RetrievedChunk[] = evidence.map((item, index) => ({ chunkId: index, sourceId: item.id, sourceTitle: item.title, text: item.text, pageNumber: item.pageNumber, charStart: item.start, charEnd: item.end, score: item.score }));
  const prompt = buildGroundedPrompt(question, chunks, [], lang);
  const raw = await provider.chat({ ...prompt, signal, temperature: 0.2 });
  const answer = resolveCitations(raw, chunks);
  return { ...answer, insufficient: answer.citations.length === 0 || answer.text.includes(noEvidenceMessage(lang)), evidence };
}
