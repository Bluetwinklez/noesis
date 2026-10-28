import type { Database } from '../db/driver';
import type {
  Attachment,
  AudioOverview,
  ChatMessage,
  Citation,
  Notebook,
  NotebookNote,
  NotebookNoteKind,
  PipelineStage,
  SemanticLink,
  Source,
  SourceChunk,
  SourceKind,
  SourceStatus,
} from '../types';
import { now, parseJson, uid } from '../../lib/util';
import { indexRemove, indexRemoveByParent, indexUpsert } from './search-index';

export class AttachmentRepo {
  constructor(private db: Database) {}

  async create(a: Omit<Attachment, 'id' | 'created_at'>): Promise<Attachment> {
    const att: Attachment = { ...a, id: uid(), created_at: now() };
    await this.db.run(
      'INSERT INTO attachments(id, workspace_id, file_name, mime, size, storage_key, sha256, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [att.id, att.workspace_id, att.file_name, att.mime, att.size, att.storage_key, att.sha256, att.created_at],
    );
    return att;
  }

  get(id: string) {
    return this.db.get<Attachment>('SELECT * FROM attachments WHERE id = ?', [id]);
  }

  list(workspaceId: string) {
    return this.db.all<Attachment>('SELECT * FROM attachments WHERE workspace_id = ? ORDER BY created_at DESC', [workspaceId]);
  }

  async remove(id: string) {
    await this.db.run('DELETE FROM attachments WHERE id = ?', [id]);
  }
}

export class NotebookRepo {
  constructor(private db: Database) {}

  async create(workspaceId: string, title: string, description = ''): Promise<Notebook> {
    const t = now();
    const nb: Notebook = {
      id: uid(),
      workspace_id: workspaceId,
      title: title.trim() || 'Untitled notebook',
      description,
      icon: '📓',
      created_at: t,
      updated_at: t,
    };
    await this.db.transaction(async (tx) => {
      await tx.run('INSERT INTO notebooks(id, workspace_id, title, description, icon, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [
        nb.id, nb.workspace_id, nb.title, nb.description, nb.icon, t, t,
      ]);
      await indexUpsert(tx, 'notebook', nb.id, workspaceId, null, nb.title, description);
    });
    return nb;
  }

  list(workspaceId: string) {
    return this.db.all<Notebook & { source_count: number }>(
      `SELECT n.*, (SELECT COUNT(*) FROM notebook_sources s WHERE s.notebook_id = n.id) AS source_count
       FROM notebooks n WHERE workspace_id = ? ORDER BY updated_at DESC`,
      [workspaceId],
    );
  }

  get(id: string) {
    return this.db.get<Notebook>('SELECT * FROM notebooks WHERE id = ?', [id]);
  }

  async update(id: string, patch: { title?: string; description?: string; icon?: string }) {
    const cur = await this.get(id);
    if (!cur) throw new Error('Notebook not found');
    const next = { ...cur, ...patch, updated_at: now() };
    await this.db.transaction(async (tx) => {
      await tx.run('UPDATE notebooks SET title=?, description=?, icon=?, updated_at=? WHERE id=?', [
        next.title, next.description, next.icon, next.updated_at, id,
      ]);
      await indexUpsert(tx, 'notebook', id, cur.workspace_id, null, next.title, next.description);
    });
  }

  async remove(id: string) {
    await this.db.transaction(async (tx) => {
      await indexRemove(tx, 'notebook', id);
      await indexRemoveByParent(tx, 'note', id);
      await tx.run('DELETE FROM notebooks WHERE id = ?', [id]);
    });
  }

  async addSource(notebookId: string, sourceId: string) {
    await this.db.run('INSERT OR IGNORE INTO notebook_sources(notebook_id, source_id, selected) VALUES (?,?,1)', [notebookId, sourceId]);
    await this.db.run('UPDATE notebooks SET updated_at = ? WHERE id = ?', [now(), notebookId]);
  }

  async removeSource(notebookId: string, sourceId: string) {
    await this.db.run('DELETE FROM notebook_sources WHERE notebook_id = ? AND source_id = ?', [notebookId, sourceId]);
  }

  async setSelected(notebookId: string, sourceId: string, selected: boolean) {
    await this.db.run('UPDATE notebook_sources SET selected = ? WHERE notebook_id = ? AND source_id = ?', [
      selected ? 1 : 0,
      notebookId,
      sourceId,
    ]);
  }

  async setAllSelected(notebookId: string, selected: boolean) {
    await this.db.run('UPDATE notebook_sources SET selected = ? WHERE notebook_id = ?', [selected ? 1 : 0, notebookId]);
  }

  sources(notebookId: string) {
    return this.db.all<Source & { selected: number }>(
      `SELECT s.*, ns.selected FROM notebook_sources ns JOIN sources s ON s.id = ns.source_id
       WHERE ns.notebook_id = ? ORDER BY s.created_at`,
      [notebookId],
    );
  }

  // ---- chat ----
  async messages(notebookId: string): Promise<ChatMessage[]> {
    const rows = await this.db.all<Omit<ChatMessage, 'citations' | 'insufficient'> & { citations_json: string; insufficient: number }>(
      'SELECT * FROM chat_messages WHERE notebook_id = ? ORDER BY created_at, rowid',
      [notebookId],
    );
    return rows.map(({ citations_json, insufficient, ...r }) => ({ ...r, insufficient: !!insufficient, citations: parseJson<Citation[]>(citations_json, []) }));
  }

  async addMessage(m: Omit<ChatMessage, 'id' | 'created_at' | 'insufficient'> & { insufficient?: boolean }): Promise<ChatMessage> {
    const msg: ChatMessage = { ...m, insufficient: m.insufficient ?? (m.role === 'assistant' && m.status === 'complete' && m.citations.length === 0), id: uid(), created_at: now() };
    await this.db.run(
      'INSERT INTO chat_messages(id, notebook_id, role, content, citations_json, status, insufficient, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [msg.id, msg.notebook_id, msg.role, msg.content, JSON.stringify(msg.citations), msg.status, msg.insufficient ? 1 : 0, msg.created_at],
    );
    return msg;
  }

  async clearChat(notebookId: string) {
    await this.db.run('DELETE FROM chat_messages WHERE notebook_id = ?', [notebookId]);
  }

  // ---- notes / studio outputs ----
  async notes(notebookId: string): Promise<NotebookNote[]> {
    const rows = await this.db.all<Omit<NotebookNote, 'data' | 'citations'> & { data_json: string; citations_json: string }>(
      'SELECT * FROM notebook_notes WHERE notebook_id = ? ORDER BY created_at DESC',
      [notebookId],
    );
    return rows.map(({ data_json, citations_json, ...r }) => ({
      ...r,
      data: parseJson(data_json, {}),
      citations: parseJson<Citation[]>(citations_json, []),
    }));
  }

  async addNote(
    notebookId: string,
    kind: NotebookNoteKind,
    title: string,
    contentMd: string,
    data: Record<string, unknown> = {},
    citations: Citation[] = [],
  ): Promise<NotebookNote> {
    const nb = await this.get(notebookId);
    if (!nb) throw new Error('Notebook not found');
    const t = now();
    const note: NotebookNote = { id: uid(), notebook_id: notebookId, kind, title, content_md: contentMd, data, citations, created_at: t, updated_at: t };
    await this.db.transaction(async (tx) => {
      await tx.run(
        'INSERT INTO notebook_notes(id, notebook_id, kind, title, content_md, data_json, citations_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [note.id, notebookId, kind, title, contentMd, JSON.stringify(data), JSON.stringify(citations), t, t],
      );
      await indexUpsert(tx, 'note', note.id, nb.workspace_id, notebookId, title, contentMd);
    });
    return note;
  }

  async updateNote(id: string, patch: { title?: string; content_md?: string; data?: Record<string, unknown> }) {
    const cur = await this.db.get<NotebookNote & { data_json: string }>('SELECT * FROM notebook_notes WHERE id = ?', [id]);
    if (!cur) throw new Error('Note not found');
    const nb = await this.get(cur.notebook_id);
    const title = patch.title ?? cur.title;
    const content = patch.content_md ?? cur.content_md;
    await this.db.transaction(async (tx) => {
      await tx.run('UPDATE notebook_notes SET title=?, content_md=?, data_json=?, updated_at=? WHERE id=?', [
        title,
        content,
        patch.data ? JSON.stringify(patch.data) : cur.data_json,
        now(),
        id,
      ]);
      await indexUpsert(tx, 'note', id, nb!.workspace_id, cur.notebook_id, title, content);
    });
  }

  async removeNote(id: string) {
    await this.db.transaction(async (tx) => {
      await indexRemove(tx, 'note', id);
      await tx.run('DELETE FROM notebook_notes WHERE id = ?', [id]);
    });
  }

  // ---- audio ----
  async audioOverviews(notebookId: string): Promise<AudioOverview[]> {
    const rows = await this.db.all<
      Omit<AudioOverview, 'script' | 'source_ids'> & { script_json: string; source_ids_json: string }
    >('SELECT * FROM audio_overviews WHERE notebook_id = ? ORDER BY created_at DESC', [notebookId]);
    return rows.map(({ script_json, source_ids_json, ...r }) => ({
      ...r,
      script: parseJson(script_json, []),
      source_ids: parseJson(source_ids_json, []),
    }));
  }

  async addAudioOverview(a: Omit<AudioOverview, 'id' | 'created_at'>): Promise<AudioOverview> {
    const ov: AudioOverview = { ...a, id: uid(), created_at: now() };
    await this.db.run(
      `INSERT INTO audio_overviews(id, notebook_id, title, language, length, format, script_json, attachment_id, provider, source_ids_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [ov.id, ov.notebook_id, ov.title, ov.language, ov.length, ov.format, JSON.stringify(ov.script), ov.attachment_id, ov.provider, JSON.stringify(ov.source_ids), ov.created_at],
    );
    return ov;
  }

  async removeAudioOverview(id: string) {
    await this.db.run('DELETE FROM audio_overviews WHERE id = ?', [id]);
  }
}

export class SourceRepo {
  constructor(private db: Database) {}

  async create(s: {
    workspaceId: string;
    title: string;
    kind: SourceKind;
    origin: string;
    mime?: string;
    size?: number;
    attachmentId?: string | null;
  }): Promise<Source> {
    const t = now();
    const src: Source = {
      id: uid(),
      workspace_id: s.workspaceId,
      title: s.title.slice(0, 300) || 'Untitled source',
      kind: s.kind,
      origin: s.origin,
      mime: s.mime ?? '',
      size: s.size ?? 0,
      attachment_id: s.attachmentId ?? null,
      status: 'pending',
      stage: 'import',
      error: null,
      text_content: '',
      page_count: null,
      metadata_json: '{}',
      embedding_model: null,
      created_at: t,
      updated_at: t,
    };
    await this.db.run(
      `INSERT INTO sources(id, workspace_id, title, kind, origin, mime, size, attachment_id, status, stage, error, text_content,
        page_count, metadata_json, embedding_model, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        src.id, src.workspace_id, src.title, src.kind, src.origin, src.mime, src.size, src.attachment_id, src.status, src.stage,
        null, '', null, '{}', null, t, t,
      ],
    );
    return src;
  }

  get(id: string) {
    return this.db.get<Source>('SELECT * FROM sources WHERE id = ?', [id]);
  }

  list(workspaceId: string) {
    return this.db.all<Source>(
      `SELECT id, workspace_id, title, kind, origin, mime, size, attachment_id, status, stage, error, '' AS text_content,
        page_count, metadata_json, embedding_model, created_at, updated_at FROM sources WHERE workspace_id = ? ORDER BY created_at DESC`,
      [workspaceId],
    );
  }

  async setAttachment(id: string, attachmentId: string) {
    await this.db.run('UPDATE sources SET attachment_id = ?, updated_at = ? WHERE id = ?', [attachmentId, now(), id]);
  }

  async setStatus(id: string, status: SourceStatus, stage: PipelineStage, error: string | null = null) {
    await this.db.run('UPDATE sources SET status = ?, stage = ?, error = ?, updated_at = ? WHERE id = ?', [status, stage, error, now(), id]);
  }

  async setExtracted(id: string, text: string, pageCount: number | null, metadata: Record<string, unknown>) {
    await this.db.run('UPDATE sources SET text_content = ?, page_count = ?, metadata_json = ?, updated_at = ? WHERE id = ?', [
      text,
      pageCount,
      JSON.stringify(metadata),
      now(),
      id,
    ]);
  }

  async rename(id: string, title: string) {
    const s = await this.get(id);
    if (!s) throw new Error('Source not found');
    await this.db.transaction(async (tx) => {
      await tx.run('UPDATE sources SET title = ?, updated_at = ? WHERE id = ?', [title, now(), id]);
      await indexUpsert(tx, 'source', id, s.workspace_id, null, title, s.text_content.slice(0, 20000));
    });
  }

  /** Replaces chunks atomically and refreshes the source's search entry. */
  async replaceChunks(
    id: string,
    chunks: { text: string; pageNumber: number | null; charStart: number; charEnd: number; embedding: number[] | null }[],
    embeddingModel: string | null,
  ) {
    const s = await this.get(id);
    if (!s) throw new Error('Source not found');
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM source_chunks WHERE source_id = ?', [id]);
      let i = 0;
      for (const c of chunks) {
        await tx.run(
          'INSERT INTO source_chunks(source_id, ordinal, text, page_number, char_start, char_end, embedding) VALUES (?,?,?,?,?,?,?)',
          [id, i++, c.text, c.pageNumber, c.charStart, c.charEnd, c.embedding ? JSON.stringify(c.embedding.map((x) => Math.round(x * 1e5) / 1e5)) : null],
        );
      }
      await tx.run('UPDATE sources SET embedding_model = ?, updated_at = ? WHERE id = ?', [embeddingModel, now(), id]);
      await indexUpsert(tx, 'source', id, s.workspace_id, null, s.title, s.text_content.slice(0, 20000));
    });
  }

  chunks(sourceId: string) {
    return this.db.all<SourceChunk>('SELECT * FROM source_chunks WHERE source_id = ? ORDER BY ordinal', [sourceId]);
  }

  async chunkCount(sourceId: string) {
    return (await this.db.get<{ c: number }>('SELECT COUNT(*) c FROM source_chunks WHERE source_id = ?', [sourceId]))?.c ?? 0;
  }

  async remove(id: string) {
    await this.db.transaction(async (tx) => {
      await indexRemove(tx, 'source', id);
      await tx.run('DELETE FROM sources WHERE id = ?', [id]);
    });
  }
}

export class SemanticLinkRepo {
  constructor(private db: Database) {}

  async suggest(fromKind: string, fromId: string, toKind: string, toId: string, score: number) {
    await this.db.run(
      `INSERT INTO semantic_links(id, from_kind, from_id, to_kind, to_id, score, status, created_at) VALUES (?,?,?,?,?,?, 'suggested', ?)
       ON CONFLICT(from_kind, from_id, to_kind, to_id) DO UPDATE SET score = excluded.score`,
      [uid(), fromKind, fromId, toKind, toId, score, now()],
    );
  }

  async setStatus(id: string, status: SemanticLink['status']) {
    await this.db.run('UPDATE semantic_links SET status = ? WHERE id = ?', [status, id]);
  }

  forItem(kind: string, id: string) {
    return this.db.all<SemanticLink>(
      `SELECT * FROM semantic_links WHERE ((from_kind = ? AND from_id = ?) OR (to_kind = ? AND to_id = ?)) AND status != 'rejected'
       ORDER BY score DESC`,
      [kind, id, kind, id],
    );
  }

  approved() {
    return this.db.all<SemanticLink>("SELECT * FROM semantic_links WHERE status = 'approved'");
  }
}

export class SettingsRepo {
  constructor(private db: Database) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', [key]);
    return row ? parseJson<T>(row.value_json, fallback) : fallback;
  }

  async set(key: string, value: unknown) {
    await this.db.run(
      'INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      [key, JSON.stringify(value)],
    );
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.db.all<{ key: string; value_json: string }>('SELECT * FROM settings');
    return Object.fromEntries(rows.map((r) => [r.key, parseJson(r.value_json, null)]));
  }
}
