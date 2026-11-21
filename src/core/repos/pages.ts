import type { Database, Executor } from '../db/driver';
import { extractDoc, type DocNode } from '../doc';
import { rewriteDocPageLinks } from '../duplicates';
import { buildMergedDoc, type MergePagesOptions, type MergePagesResult } from '../merge';
import type { Page, PageMeta, Tag, Workspace } from '../types';
import { now, parseJson, uid } from '../../lib/util';
import { indexRemove, indexUpsert } from './search-index';

export type { MergePagesOptions, MergePagesResult };

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

export type BrokenLinkReason = 'missing' | 'trashed';

export interface BrokenLink {
  source_id: string;
  source_title: string;
  target_id: string;
  target_title: string | null;
  reason: BrokenLinkReason;
}

export interface OrphanPage {
  id: string;
  title: string;
  parent_id: string;
  parent_title: string | null;
  reason: BrokenLinkReason;
}

export interface LinkHealthReport {
  brokenLinks: BrokenLink[];
  orphans: OrphanPage[];
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
      if (cur.deleted_at || cur.archived_at) await indexRemove(tx, 'page', id);
      else await indexUpsert(tx, 'page', id, cur.workspace_id, cur.parent_id, title ?? cur.title, text);
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
    if (p.deleted_at || p.archived_at) await indexRemove(tx, 'page', id);
    else await indexUpsert(tx, 'page', id, p.workspace_id, p.parent_id, p.title, p.content_text);
  }

  backlinks(id: string) {
    return this.db.all<PageMeta>(
      `SELECT ${META_COLS.split(', ').map((c) => 'p.' + c).join(', ')} FROM page_links l JOIN pages p ON p.id = l.source_id
       WHERE l.target_id = ? AND p.deleted_at IS NULL ORDER BY p.title`,
      [id],
    );
  }

  /**
   * Returns live pages in `workspaceId` with broken internal links (target page
   * missing or in the trash) and live pages whose parent is missing or trashed.
   */
  async linkHealth(workspaceId: string): Promise<LinkHealthReport> {
    const brokenLinks = await this.db.all<BrokenLink>(
      `SELECT
         l.source_id,
         s.title AS source_title,
         l.target_id,
         CASE WHEN t.id IS NOT NULL AND t.workspace_id = s.workspace_id THEN t.title ELSE NULL END AS target_title,
         CASE WHEN t.id IS NOT NULL AND t.workspace_id = s.workspace_id AND t.deleted_at IS NOT NULL THEN 'trashed' ELSE 'missing' END AS reason
       FROM page_links l
       JOIN pages s ON s.id = l.source_id
       LEFT JOIN pages t ON t.id = l.target_id
       WHERE s.workspace_id = ?
         AND s.deleted_at IS NULL
         AND (t.id IS NULL OR t.workspace_id != s.workspace_id OR t.deleted_at IS NOT NULL)
       ORDER BY s.title COLLATE NOCASE, l.source_id, l.target_id`,
      [workspaceId],
    );
    const orphans = await this.db.all<OrphanPage>(
      `SELECT
         p.id,
         p.title,
         p.parent_id,
         CASE WHEN parent.id IS NOT NULL AND parent.workspace_id = p.workspace_id THEN parent.title ELSE NULL END AS parent_title,
         CASE WHEN parent.id IS NOT NULL AND parent.workspace_id = p.workspace_id AND parent.deleted_at IS NOT NULL THEN 'trashed' ELSE 'missing' END AS reason
       FROM pages p
       LEFT JOIN pages parent ON parent.id = p.parent_id
       WHERE p.workspace_id = ?
         AND p.deleted_at IS NULL
         AND p.parent_id IS NOT NULL
         AND (parent.id IS NULL OR parent.workspace_id != p.workspace_id OR parent.deleted_at IS NOT NULL)
       ORDER BY p.title COLLATE NOCASE, p.id`,
      [workspaceId],
    );
    return { brokenLinks, orphans };
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

  /**
   * Merges `sourceIds` (in order) into `targetId` within `workspaceId` inside one transaction:
   * - appends each source's body under a level-2 heading with its title (skipping a matching
   *   leading H1 and demoting remaining headings by 1, capped at 4),
   * - re-points every internal link (`page_links` rows, `noesis://page/<id>` link marks and
   *   `pageMention` nodes) referencing any source to `targetId`,
   * - moves live non-source sub-pages of each source under `targetId`,
   * - moves each source page to the trash (restorable) and refreshes the search index.
   *
   * Rejects empty source lists, target listed among sources, cycles (target inside a source's
   * subtree), cross-workspace ids, trashed pages, and databases.
   */
  async mergePages(
    workspaceId: string,
    targetId: string,
    sourceIds: readonly string[],
    options: MergePagesOptions = {},
  ): Promise<MergePagesResult> {
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      throw new Error('At least one source page is required');
    }
    if (sourceIds.includes(targetId)) {
      throw new Error('Target page cannot be merged into itself');
    }
    const uniqueSourceIds: string[] = [];
    const sourceIdSet = new Set<string>();
    for (const sid of sourceIds) {
      if (!sid) throw new Error('Source page id is required');
      if (sourceIdSet.has(sid)) continue;
      sourceIdSet.add(sid);
      uniqueSourceIds.push(sid);
    }

    const untitledLabel = options.untitledLabel ?? 'Untitled';

    return this.db.transaction(async (tx) => {
      const target = await tx.get<Page>('SELECT * FROM pages WHERE id = ?', [targetId]);
      if (!target) throw new Error('Target page not found');
      if (target.workspace_id !== workspaceId) throw new Error('Target page belongs to another workspace');
      if (target.deleted_at) throw new Error('Cannot merge into a trashed page');
      if (target.kind !== 'page') throw new Error('Cannot merge into a database');

      const sources: Page[] = [];
      for (const sid of uniqueSourceIds) {
        const src = await tx.get<Page>('SELECT * FROM pages WHERE id = ?', [sid]);
        if (!src) throw new Error(`Source page not found: ${sid}`);
        if (src.workspace_id !== workspaceId) throw new Error('Source page belongs to another workspace');
        if (src.deleted_at) throw new Error('Cannot merge a trashed page');
        if (src.kind !== 'page') throw new Error('Cannot merge a database page');
        sources.push(src);
      }

      // Reject cycles: target cannot be inside any source's subtree.
      const ancestors = await tx.all<{ id: string }>(
        `WITH RECURSIVE up(id, depth) AS (
           SELECT parent_id, 0 FROM pages WHERE id = ? AND parent_id IS NOT NULL
           UNION ALL
           SELECT p.parent_id, up.depth + 1 FROM pages p JOIN up ON p.id = up.id
           WHERE p.parent_id IS NOT NULL AND up.depth < 64
         )
         SELECT id FROM up`,
        [targetId],
      );
      if (ancestors.some((a) => sourceIdSet.has(a.id))) {
        throw new Error('Cannot merge a page into one of its own sub-pages');
      }

      const t = now();
      const targetTitle = target.title.trim() || untitledLabel;
      const idMap = new Map<string, string>(uniqueSourceIds.map((id) => [id, targetId]));

      // 1. Preserve a pre-merge snapshot of the target page when it has content.
      if (target.content_json) {
        await tx.run('INSERT INTO page_snapshots(page_id, title, content_json, created_at) VALUES (?,?,?,?)', [
          targetId,
          target.title,
          target.content_json,
          t,
        ]);
        await tx.run(
          `DELETE FROM page_snapshots WHERE page_id = ? AND id NOT IN (
             SELECT id FROM page_snapshots WHERE page_id = ? ORDER BY created_at DESC LIMIT ?)`,
          [targetId, targetId, SNAPSHOTS_KEPT],
        );
      }

      // 2. Append each source body in order under an H2, demote headings, and rewrite internal links.
      const targetDoc = parseJson<DocNode | null>(target.content_json, null);
      const rawMergedDoc = buildMergedDoc(
        targetDoc,
        sources.map((src) => ({ title: src.title, doc: parseJson<DocNode | null>(src.content_json, null) })),
        untitledLabel,
      );
      const { doc: mergedDoc, count: targetRewrittenLinks } = rewriteDocPageLinks(rawMergedDoc, idMap, targetTitle);
      const { text: mergedText, linkedPageIds: targetLinks } = extractDoc(mergedDoc);
      await tx.run('UPDATE pages SET content_json = ?, content_text = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify(mergedDoc),
        mergedText,
        t,
        targetId,
      ]);
      await this.syncLinks(tx, targetId, targetLinks);
      if (target.archived_at) await indexRemove(tx, 'page', targetId);
      else await indexUpsert(tx, 'page', targetId, target.workspace_id, target.parent_id, target.title, mergedText);

      // 3. Re-point internal links in all other live pages in the workspace (bodies and page_links).
      const ph = uniqueSourceIds.map(() => '?').join(',');
      const instrClauses = uniqueSourceIds.map(() => "instr(COALESCE(content_json, ''), ?) > 0").join(' OR ');
      const candidates = await tx.all<Page>(
        `SELECT * FROM pages
         WHERE workspace_id = ?
           AND deleted_at IS NULL
           AND id != ?
           AND id NOT IN (${ph})
           AND (
             id IN (SELECT source_id FROM page_links WHERE target_id IN (${ph}))
             OR (${instrClauses})
           )`,
        [workspaceId, targetId, ...uniqueSourceIds, ...uniqueSourceIds, ...uniqueSourceIds],
      );

      let redirectedPages = 0;
      let redirectedLinks = targetRewrittenLinks;
      for (const p of candidates) {
        if (!p.content_json) continue;
        const doc = parseJson<DocNode | null>(p.content_json, null);
        if (!doc) continue;
        const { doc: rewritten, count } = rewriteDocPageLinks(doc, idMap, targetTitle);
        if (count === 0) continue;
        const { text, linkedPageIds } = extractDoc(rewritten);
        await tx.run('UPDATE pages SET content_json = ?, content_text = ?, updated_at = ? WHERE id = ?', [
          JSON.stringify(rewritten),
          text,
          t,
          p.id,
        ]);
        await this.syncLinks(tx, p.id, linkedPageIds);
        if (p.archived_at) await indexRemove(tx, 'page', p.id);
        else await indexUpsert(tx, 'page', p.id, p.workspace_id, p.parent_id, p.title, text);
        redirectedPages++;
        redirectedLinks += count;
      }

      // Also re-point any remaining page_links rows pointing to merged sources (e.g. without body marks)
      // and remove stale rows targeting merged sources.
      await tx.run(
        `INSERT OR IGNORE INTO page_links(source_id, target_id)
         SELECT l.source_id, ?
         FROM page_links l
         JOIN pages p ON p.id = l.source_id
         WHERE l.target_id IN (${ph})
           AND p.workspace_id = ?
           AND p.deleted_at IS NULL
           AND l.source_id != ?
           AND l.source_id NOT IN (${ph})`,
        [targetId, ...uniqueSourceIds, workspaceId, targetId, ...uniqueSourceIds],
      );
      await tx.run(
        `DELETE FROM page_links
         WHERE target_id IN (${ph})
           AND source_id IN (SELECT id FROM pages WHERE workspace_id = ?)`,
        [...uniqueSourceIds, workspaceId],
      );

      // 4. Move live non-source sub-pages of each source under the target (preserving order).
      const maxChild = await tx.get<{ m: number | null }>(
        'SELECT MAX(sort_order) AS m FROM pages WHERE workspace_id = ? AND parent_id = ?',
        [workspaceId, targetId],
      );
      let nextSort = (maxChild?.m ?? 0) + 1;
      let movedSubpageCount = 0;
      for (const sid of uniqueSourceIds) {
        const children = await tx.all<Page>(
          'SELECT * FROM pages WHERE workspace_id = ? AND parent_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at',
          [workspaceId, sid],
        );
        for (const child of children) {
          if (sourceIdSet.has(child.id)) continue;
          await tx.run('UPDATE pages SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?', [
            targetId,
            nextSort++,
            t,
            child.id,
          ]);
          if (child.archived_at) await indexRemove(tx, 'page', child.id);
          else await indexUpsert(tx, 'page', child.id, child.workspace_id, targetId, child.title, child.content_text);
          movedSubpageCount++;
        }
      }

      // 5. Move source pages to the trash (restorable) and drop them from search_index.
      for (const sid of uniqueSourceIds) {
        await tx.run('UPDATE pages SET deleted_at = ?, is_pinned = 0 WHERE id = ? AND deleted_at IS NULL', [t, sid]);
        await indexRemove(tx, 'page', sid);
        await tx.run("DELETE FROM search_index WHERE kind = 'row' AND parent_id = ?", [sid]);
      }

      return {
        targetId,
        targetTitle,
        mergedSourceIds: uniqueSourceIds,
        mergedSourceTitles: sources.map((s) => s.title.trim() || untitledLabel),
        movedSubpageCount,
        redirectedPages,
        redirectedLinks,
        totalSourceChars: sources.reduce((sum, s) => sum + s.content_text.length, 0),
      };
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
    await this.db.transaction(async (tx) => {
      await tx.run('UPDATE pages SET archived_at = ?, updated_at = ? WHERE id = ?', [archived ? now() : null, now(), id]);
      await this.reindex(tx, id);
      if (archived) await tx.run("DELETE FROM search_index WHERE kind = 'row' AND parent_id = ?", [id]);
    });
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
