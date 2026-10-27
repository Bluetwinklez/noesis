import type { Database, Executor } from '../db/driver';
import { extractDoc, type DocNode } from '../doc';
import type { Page, PageMeta, Tag, Workspace } from '../types';
import { now, uid } from '../../lib/util';
import { indexRemove, indexUpsert } from './search-index';

const META_COLS =
  'id, workspace_id, parent_id, kind, title, icon, cover, is_favorite, is_pinned, is_template, archived_at, deleted_at, sort_order, created_at, updated_at';

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const SNAPSHOTS_KEPT = 20;

export class WorkspaceRepo {
  constructor(private db: Database) {}

  list() {
    return this.db.all<Workspace>('SELECT * FROM workspaces ORDER BY created_at');
  }

  async create(name: string, icon: string | null = null): Promise<Workspace> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Workspace name is required');
    const ws: Workspace = { id: uid(), name: trimmed.slice(0, 200), icon, created_at: now(), updated_at: now() };
    await this.db.run('INSERT INTO workspaces(id,name,icon,created_at,updated_at) VALUES (?,?,?,?,?)', [
      ws.id,
      ws.name,
      ws.icon,
      ws.created_at,
      ws.updated_at,
    ]);
    return ws;
  }

  async rename(id: string, name: string, icon?: string | null) {
    if (!name.trim()) throw new Error('Workspace name is required');
    await this.db.run('UPDATE workspaces SET name = ?, icon = COALESCE(?, icon), updated_at = ? WHERE id = ?', [
      name.trim(),
      icon ?? null,
      now(),
      id,
    ]);
  }

  async remove(id: string) {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM search_index WHERE workspace_id = ?', [id]);
      await tx.run('DELETE FROM workspaces WHERE id = ?', [id]);
    });
  }
}

export interface CreatePageInput {
  workspaceId: string;
  parentId?: string | null;
  title?: string;
  kind?: 'page' | 'database';
  icon?: string | null;
  content?: DocNode | null;
  isTemplate?: boolean;
}

export class PageRepo {
  constructor(private db: Database) {}

  async create(input: CreatePageInput): Promise<Page> {
    return this.db.transaction((tx) => this.createIn(tx, input));
  }

  async createIn(tx: Executor, input: CreatePageInput): Promise<Page> {
    if (input.parentId) {
      const parent = await tx.get<{ workspace_id: string }>('SELECT workspace_id FROM pages WHERE id = ?', [input.parentId]);
      if (!parent) throw new Error('Parent page does not exist');
      if (parent.workspace_id !== input.workspaceId) throw new Error('Parent page belongs to another workspace');
    }
    const max = await tx.get<{ m: number | null }>(
      'SELECT MAX(sort_order) AS m FROM pages WHERE workspace_id = ? AND parent_id IS ?',
      [input.workspaceId, input.parentId ?? null],
    );
    const content = input.content ?? null;
    const { text, linkedPageIds } = extractDoc(content);
    const t = now();
    const page: Page = {
      id: uid(),
      workspace_id: input.workspaceId,
      parent_id: input.parentId ?? null,
      kind: input.kind ?? 'page',
      title: (input.title ?? '').slice(0, 500),
      icon: input.icon ?? null,
      cover: null,
      content_json: content ? JSON.stringify(content) : null,
      content_text: text,
      is_favorite: 0,
      is_pinned: 0,
      is_template: input.isTemplate ? 1 : 0,
      archived_at: null,
      deleted_at: null,
      sort_order: (max?.m ?? 0) + 1,
      created_at: t,
      updated_at: t,
    };
    await tx.run(
      `INSERT INTO pages(id, workspace_id, parent_id, kind, title, icon, cover, content_json, content_text,
        is_favorite, is_pinned, is_template, archived_at, deleted_at, sort_order, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        page.id, page.workspace_id, page.parent_id, page.kind, page.title, page.icon, page.cover,
        page.content_json, page.content_text, 0, 0, page.is_template, null, null, page.sort_order, t, t,
      ],
    );
    await this.syncLinks(tx, page.id, linkedPageIds);
    await indexUpsert(tx, 'page', page.id, page.workspace_id, page.parent_id, page.title, text);
    return page;
  }

  get(id: string) {
    return this.db.get<Page>('SELECT * FROM pages WHERE id = ?', [id]);
  }

  /** Sidebar tree data: all live (non-deleted, non-archived) pages without content. */
  listTree(workspaceId: string) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS} FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL
       ORDER BY sort_order, created_at`,
      [workspaceId],
    );
  }

  /** Every page that is not in the trash, with content (full export). */
  listAllLive(workspaceId: string) {
    return this.db.all<Page>('SELECT * FROM pages WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at', [workspaceId]);
  }

  listRecentlyEdited(workspaceId: string, limit = 20) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS} FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND kind = 'page'
       ORDER BY updated_at DESC LIMIT ?`,
      [workspaceId, limit],
    );
  }

  listFavorites(workspaceId: string) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS} FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND is_favorite = 1 ORDER BY title`,
      [workspaceId],
    );
  }

  listPinned(workspaceId: string) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS} FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND is_pinned = 1 ORDER BY title`,
      [workspaceId],
    );
  }

  listTemplates(workspaceId: string) {
    return this.db.all<Page>(
      'SELECT * FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND is_template = 1 ORDER BY title',
      [workspaceId],
    );
  }

  listTrash(workspaceId: string) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS} FROM pages WHERE workspace_id = ? AND deleted_at IS NOT NULL
       AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM pages WHERE deleted_at IS NOT NULL))
       ORDER BY deleted_at DESC`,
      [workspaceId],
    );
  }

  listArchived(workspaceId: string) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS} FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL ORDER BY archived_at DESC`,
      [workspaceId],
    );
  }

  /** Root-to-page chain for breadcrumbs. */
  async ancestors(id: string): Promise<PageMeta[]> {
    return this.db.all<PageMeta>(
      `WITH RECURSIVE chain(id, depth) AS (
         SELECT ?, 0
         UNION ALL
         SELECT p.parent_id, chain.depth + 1 FROM pages p JOIN chain ON p.id = chain.id
         WHERE p.parent_id IS NOT NULL AND chain.depth < 64)
       SELECT ${META_COLS.split(', ').map((c) => 'p.' + c).join(', ')} FROM chain JOIN pages p ON p.id = chain.id
       ORDER BY chain.depth DESC`,
      [id],
    );
  }

  async updateMeta(
    id: string,
    patch: Partial<Pick<PageMeta, 'title' | 'icon' | 'cover' | 'is_favorite' | 'is_pinned' | 'is_template'>>,
  ) {
    const fields = Object.keys(patch) as (keyof typeof patch)[];
    if (!fields.length) return;
    await this.db.transaction(async (tx) => {
      const sets = fields.map((f) => `${f} = ?`).join(', ');
      await tx.run(`UPDATE pages SET ${sets}, updated_at = ? WHERE id = ?`, [
        ...fields.map((f) => (patch[f] ?? null) as string | number | null),
        now(),
        id,
      ]);
      if ('title' in patch) await this.reindex(tx, id);
    });
  }

  /**
   * Autosave entry point. Writes content atomically, refreshes links and the
   * search index, and keeps periodic snapshots for crash recovery / history.
   */
  async saveContent(id: string, doc: DocNode, title?: string): Promise<void> {
    const { text, linkedPageIds } = extractDoc(doc);
    const json = JSON.stringify(doc);
    await this.db.transaction(async (tx) => {
      const cur = await tx.get<Page>('SELECT * FROM pages WHERE id = ?', [id]);
      if (!cur) throw new Error('Page no longer exists');
      const t = now();
      await tx.run(
        'UPDATE pages SET content_json = ?, content_text = ?, title = COALESCE(?, title), updated_at = ? WHERE id = ?',
        [json, text, title ?? null, t, id],
      );
      const last = await tx.get<{ created_at: number }>(
        'SELECT created_at FROM page_snapshots WHERE page_id = ? ORDER BY created_at DESC LIMIT 1',
        [id],
      );
      if (cur.content_json && (!last || t - last.created_at > SNAPSHOT_INTERVAL_MS)) {
        await tx.run('INSERT INTO page_snapshots(page_id, title, content_json, created_at) VALUES (?,?,?,?)', [
          id,
          cur.title,
          cur.content_json,
          t,
        ]);
        await tx.run(
          `DELETE FROM page_snapshots WHERE page_id = ? AND id NOT IN (
             SELECT id FROM page_snapshots WHERE page_id = ? ORDER BY created_at DESC LIMIT ?)`,
          [id, id, SNAPSHOTS_KEPT],
        );
      }
      await this.syncLinks(tx, id, linkedPageIds);
      await indexUpsert(tx, 'page', id, cur.workspace_id, cur.parent_id, title ?? cur.title, text);
    });
  }

  listSnapshots(pageId: string) {
    return this.db.all<{ id: number; title: string; content_json: string; created_at: number }>(
      'SELECT id, title, content_json, created_at FROM page_snapshots WHERE page_id = ? ORDER BY created_at DESC',
      [pageId],
    );
  }

  private async syncLinks(tx: Executor, sourceId: string, targetIds: string[]) {
    await tx.run('DELETE FROM page_links WHERE source_id = ?', [sourceId]);
    for (const target of targetIds) {
      if (target === sourceId) continue;
      // Ignore links to pages that do not exist (e.g. pasted from elsewhere).
      await tx.run(
        'INSERT OR IGNORE INTO page_links(source_id, target_id) SELECT ?, id FROM pages WHERE id = ?',
        [sourceId, target],
      );
    }
  }

  private async reindex(tx: Executor, id: string) {
    const p = await tx.get<Page>('SELECT * FROM pages WHERE id = ?', [id]);
    if (!p) return;
    if (p.deleted_at) await indexRemove(tx, 'page', id);
    else await indexUpsert(tx, 'page', id, p.workspace_id, p.parent_id, p.title, p.content_text);
  }

  backlinks(id: string) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS.split(', ').map((c) => 'p.' + c).join(', ')} FROM page_links l JOIN pages p ON p.id = l.source_id
       WHERE l.target_id = ? AND p.deleted_at IS NULL ORDER BY p.title`,
      [id],
    );
  }

  /** Moves a page under a new parent, preventing cycles. */
  async move(id: string, newParentId: string | null, beforeSortOrder?: number) {
    await this.db.transaction(async (tx) => {
      if (newParentId) {
        if (newParentId === id) throw new Error('A page cannot contain itself');
        const cycle = await tx.get<{ id: string }>(
          `WITH RECURSIVE up(id) AS (SELECT ? UNION ALL SELECT p.parent_id FROM pages p JOIN up ON p.id = up.id WHERE p.parent_id IS NOT NULL)
           SELECT id FROM up WHERE id = ?`,
          [newParentId, id],
        );
        if (cycle) throw new Error('A page cannot be moved inside its own sub-page');
      }
      const sort = beforeSortOrder !== undefined ? beforeSortOrder - 0.5 : Date.now();
      await tx.run('UPDATE pages SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?', [
        newParentId,
        sort,
        now(),
        id,
      ]);
      await this.reindex(tx, id);
    });
  }

  /** Recursive soft delete into trash. */
  async trash(id: string) {
    await this.db.transaction(async (tx) => {
      const t = now();
      const ids = await this.descendantIds(tx, id);
      for (const pid of ids) {
        await tx.run('UPDATE pages SET deleted_at = ?, is_pinned = 0 WHERE id = ? AND deleted_at IS NULL', [t, pid]);
        await indexRemove(tx, 'page', pid);
        await tx.run("DELETE FROM search_index WHERE kind = 'row' AND parent_id = ?", [pid]);
      }
    });
  }

  async restore(id: string) {
    await this.db.transaction(async (tx) => {
      const page = await tx.get<Page>('SELECT * FROM pages WHERE id = ?', [id]);
      if (!page) throw new Error('Page not found');
      // If the original parent is gone or still trashed, restore to the root.
      if (page.parent_id) {
        const parent = await tx.get<Page>('SELECT deleted_at FROM pages WHERE id = ?', [page.parent_id]);
        if (!parent || parent.deleted_at) await tx.run('UPDATE pages SET parent_id = NULL WHERE id = ?', [id]);
      }
      for (const pid of await this.descendantIds(tx, id)) {
        await tx.run('UPDATE pages SET deleted_at = NULL, updated_at = ? WHERE id = ?', [now(), pid]);
        await this.reindex(tx, pid);
      }
    });
  }

  /** Permanently removes a trashed page and its descendants. */
  async purge(id: string) {
    await this.db.transaction(async (tx) => {
      const p = await tx.get<Page>('SELECT deleted_at FROM pages WHERE id = ?', [id]);
      if (!p) return;
      if (!p.deleted_at) throw new Error('Only pages in the trash can be deleted permanently');
      for (const pid of await this.descendantIds(tx, id)) await indexRemove(tx, 'page', pid);
      await tx.run('DELETE FROM pages WHERE id = ?', [id]);
    });
  }

  async emptyTrash(workspaceId: string) {
    const trashed = await this.listTrash(workspaceId);
    for (const p of trashed) await this.purge(p.id);
  }

  async setArchived(id: string, archived: boolean) {
    await this.db.run('UPDATE pages SET archived_at = ?, updated_at = ? WHERE id = ?', [archived ? now() : null, now(), id]);
  }

  async duplicate(id: string): Promise<Page> {
    const src = await this.get(id);
    if (!src) throw new Error('Page not found');
    return this.create({
      workspaceId: src.workspace_id,
      parentId: src.parent_id,
      title: src.title ? `${src.title} (copy)` : '',
      icon: src.icon,
      content: src.content_json ? (JSON.parse(src.content_json) as DocNode) : null,
    });
  }

  async touchRecent(id: string) {
    await this.db.run(
      'INSERT INTO recents(page_id, visited_at) VALUES (?, ?) ON CONFLICT(page_id) DO UPDATE SET visited_at = excluded.visited_at',
      [id, now()],
    );
  }

  listRecentVisited(workspaceId: string, limit = 8) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS.split(', ').map((c) => 'p.' + c).join(', ')} FROM recents r JOIN pages p ON p.id = r.page_id
       WHERE p.workspace_id = ? AND p.deleted_at IS NULL ORDER BY r.visited_at DESC LIMIT ?`,
      [workspaceId, limit],
    );
  }

  private async descendantIds(ex: Executor, id: string): Promise<string[]> {
    const rows = await ex.all<{ id: string }>(
      `WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL SELECT p.id FROM pages p JOIN sub ON p.parent_id = sub.id)
       SELECT id FROM sub`,
      [id],
    );
    return rows.map((r) => r.id);
  }

  // ---- tags ----
  listTags(workspaceId: string) {
    return this.db.all<Tag>('SELECT * FROM tags WHERE workspace_id = ? ORDER BY name', [workspaceId]);
  }

  pageTags(pageId: string) {
    return this.db.all<Tag>(
      'SELECT t.* FROM page_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.page_id = ? ORDER BY t.name',
      [pageId],
    );
  }

  async addTag(pageId: string, name: string, color = 'gray'): Promise<Tag> {
    const clean = name.trim().replace(/^#/, '').slice(0, 60);
    if (!clean) throw new Error('Tag name is required');
    return this.db.transaction(async (tx) => {
      const page = await tx.get<Page>('SELECT workspace_id FROM pages WHERE id = ?', [pageId]);
      if (!page) throw new Error('Page not found');
      let tag = await tx.get<Tag>('SELECT * FROM tags WHERE workspace_id = ? AND name = ?', [page.workspace_id, clean]);
      if (!tag) {
        tag = { id: uid(), workspace_id: page.workspace_id, name: clean, color };
        await tx.run('INSERT INTO tags(id, workspace_id, name, color) VALUES (?,?,?,?)', [
          tag.id,
          tag.workspace_id,
          tag.name,
          tag.color,
        ]);
      }
      await tx.run('INSERT OR IGNORE INTO page_tags(page_id, tag_id) VALUES (?,?)', [pageId, tag.id]);
      return tag;
    });
  }

  async removeTag(pageId: string, tagId: string) {
    await this.db.run('DELETE FROM page_tags WHERE page_id = ? AND tag_id = ?', [pageId, tagId]);
    await this.db.run('DELETE FROM tags WHERE id = ? AND id NOT IN (SELECT tag_id FROM page_tags)', [tagId]);
  }

  pagesWithTag(tagId: string) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS.split(', ').map((c) => 'p.' + c).join(', ')} FROM page_tags pt JOIN pages p ON p.id = pt.page_id
       WHERE pt.tag_id = ? AND p.deleted_at IS NULL`,
      [tagId],
    );
  }
}
