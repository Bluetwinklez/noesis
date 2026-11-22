import type { Repos } from './store';
import { PAGE_LINK_PREFIX, type DocNode } from './doc';
import type { Page, PageMeta } from './types';
import { parseJson } from '../lib/util';

export const DEFAULT_MIN_DUPLICATE_CHARS = 20;

/**
 * Normalises plain text or titles for duplicate comparisons: trims outer
 * whitespace, collapses internal whitespace runs to a single space, and lowercases.
 */
export function normalizeDuplicateText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export type DuplicatePageInput = Pick<
  Page,
  'id' | 'parent_id' | 'kind' | 'title' | 'content_text' | 'created_at' | 'deleted_at'
>;

export interface DuplicatePageEntry {
  id: string;
  title: string;
  parentId: string | null;
  /** Ancestor titles from workspace root down to direct parent (empty for top-level pages). */
  parentPath: string[];
  createdAt: number;
}

export interface DuplicateGroup {
  /** Normalised plain text shared by every page in this group. */
  key: string;
  /** Duplicate pages ordered oldest-first (index 0 is kept by default). */
  pages: DuplicatePageEntry[];
  /** Character length of the normalised plain text. */
  characters: number;
  /** True when every page in the group shares the same normalised title. */
  sameTitle: boolean;
}

export interface FindDuplicatesOptions<T extends DuplicatePageInput = DuplicatePageInput> {
  /** Ignore pages whose normalised plain text is shorter than this. Default: 20. */
  minChars?: number;
  /** Custom plain-text extractor (e.g. MCP strips `<private>` blocks before comparing). */
  getText?: (page: T) => string;
  /** Custom display-title extractor (e.g. MCP strips `<private>` markers from titles). */
  getTitle?: (page: T) => string;
}

function defaultTitle(page: DuplicatePageInput): string {
  return page.title || 'Untitled';
}

function buildParentPath<T extends DuplicatePageInput>(
  page: T,
  byId: ReadonlyMap<string, T>,
  getTitle: (p: T) => string,
): string[] {
  const path: string[] = [];
  const seen = new Set<string>([page.id]);
  let cur = page.parent_id;
  while (cur && !seen.has(cur) && path.length < 64) {
    seen.add(cur);
    const parent = byId.get(cur);
    if (!parent) break;
    path.unshift(getTitle(parent) || 'Untitled');
    cur = parent.parent_id;
  }
  return path;
}

/**
 * Pure function that groups live regular pages sharing identical normalised plain text.
 * Pages shorter than `minChars` (default 20), trashed pages, and databases are ignored.
 * Within each group, pages are ordered oldest-first (`created_at` ascending).
 */
export function findDuplicateGroups<T extends DuplicatePageInput>(
  pages: readonly T[],
  opts: FindDuplicatesOptions<T> = {},
): DuplicateGroup[] {
  const minChars = opts.minChars ?? DEFAULT_MIN_DUPLICATE_CHARS;
  const getText = opts.getText ?? ((p: T) => p.content_text);
  const getTitle = opts.getTitle ?? ((p: T) => defaultTitle(p));

  const live = pages.filter((p) => !p.deleted_at);
  const byId = new Map<string, T>(live.map((p) => [p.id, p]));
  const buckets = new Map<string, { entries: DuplicatePageEntry[]; normTitles: Set<string>; characters: number }>();

  for (const p of live) {
    if (p.kind !== 'page') continue;
    const text = normalizeDuplicateText(getText(p));
    if (text.length < minChars) continue;
    const title = getTitle(p) || 'Untitled';
    let bucket = buckets.get(text);
    if (!bucket) {
      bucket = { entries: [], normTitles: new Set(), characters: text.length };
      buckets.set(text, bucket);
    }
    bucket.entries.push({
      id: p.id,
      title,
      parentId: p.parent_id,
      parentPath: buildParentPath(p, byId, getTitle),
      createdAt: p.created_at,
    });
    bucket.normTitles.add(normalizeDuplicateText(title));
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, b] of buckets) {
    if (b.entries.length < 2) continue;
    // Stable sort keeps earlier-listed rows first when timestamps tie.
    b.entries.sort((a, c) => a.createdAt - c.createdAt);
    groups.push({
      key,
      pages: b.entries,
      characters: b.characters,
      sameTitle: b.normTitles.size === 1,
    });
  }

  groups.sort(
    (a, b) =>
      Number(b.sameTitle) - Number(a.sameTitle) ||
      b.pages.length - a.pages.length ||
      b.characters - a.characters,
  );
  return groups;
}

/** Repo-level helper: scans all live pages in a workspace and returns duplicate groups. */
export async function findWorkspaceDuplicates(
  repos: Repos,
  workspaceId: string,
  opts?: FindDuplicatesOptions<Page>,
): Promise<DuplicateGroup[]> {
  const live = await repos.pages.listAllLive(workspaceId);
  return findDuplicateGroups(live, opts);
}

/**
 * Pure helper that redirects internal page links (`noesis://page/<id>` link marks
 * and `pageMention` nodes) in a TipTap document according to `idMap` without mutating
 * the input document.
 */
export function rewriteDocPageLinks(
  doc: DocNode,
  idMap: ReadonlyMap<string, string>,
  targetTitle?: string,
): { doc: DocNode; count: number } {
  let count = 0;

  const walk = (node: DocNode): DocNode => {
    let changed = false;
    let nextMarks = node.marks;
    if (node.type === 'text' && node.marks?.length) {
      let marksChanged = false;
      const mapped = node.marks.map((m) => {
        if (m.type === 'link' && typeof m.attrs?.href === 'string' && m.attrs.href.startsWith(PAGE_LINK_PREFIX)) {
          const oldId = m.attrs.href.slice(PAGE_LINK_PREFIX.length);
          const newId = idMap.get(oldId);
          if (newId && newId !== oldId) {
            marksChanged = true;
            count++;
            return { ...m, attrs: { ...m.attrs, href: PAGE_LINK_PREFIX + newId } };
          }
        }
        return m;
      });
      if (marksChanged) {
        nextMarks = mapped;
        changed = true;
      }
    }

    let nextAttrs = node.attrs;
    if (node.type === 'pageMention' && typeof node.attrs?.id === 'string') {
      const oldId = node.attrs.id;
      const newId = idMap.get(oldId);
      if (newId && newId !== oldId) {
        nextAttrs = {
          ...node.attrs,
          id: newId,
          ...(targetTitle !== undefined ? { label: targetTitle } : {}),
        };
        changed = true;
        count++;
      }
    }

    let nextContent = node.content;
    if (node.content?.length) {
      let contentChanged = false;
      const mapped = node.content.map((child) => {
        const res = walk(child);
        if (res !== child) contentChanged = true;
        return res;
      });
      if (contentChanged) {
        nextContent = mapped;
        changed = true;
      }
    }

    if (!changed) return node;
    return {
      ...node,
      ...(nextAttrs !== undefined ? { attrs: nextAttrs } : {}),
      ...(nextMarks !== undefined ? { marks: nextMarks } : {}),
      ...(nextContent !== undefined ? { content: nextContent } : {}),
    };
  };

  return { doc: walk(doc), count };
}

async function collectLiveSubtreeIds(repos: Repos, rootIds: readonly string[], workspaceId: string): Promise<Set<string>> {
  const result = new Set<string>();
  for (const id of rootIds) {
    const rows = await repos.db.all<{ id: string }>(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM pages WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
         UNION ALL
         SELECT p.id FROM pages p JOIN sub ON p.parent_id = sub.id WHERE p.workspace_id = ? AND p.deleted_at IS NULL
       )
       SELECT id FROM sub`,
      [id, workspaceId, workspaceId],
    );
    for (const r of rows) result.add(r.id);
  }
  return result;
}

/**
 * Returns live pages (outside the pages being trashed and their subtrees) that link
 * to any of `trashIds`.
 */
export async function findAffectedBacklinks(
  repos: Repos,
  trashIds: readonly string[],
  keepId?: string,
): Promise<PageMeta[]> {
  const uniqueTrash = [...new Set(trashIds)].filter((id) => id !== keepId);
  if (!uniqueTrash.length) return [];

  const first = await repos.pages.get(uniqueTrash[0]);
  if (!first) return [];
  const excluded = await collectLiveSubtreeIds(repos, uniqueTrash, first.workspace_id);
  // If keepId happens to be nested under a trashed copy, keepId itself will be rescued.
  if (keepId) excluded.delete(keepId);

  const affected = new Map<string, PageMeta>();
  for (const id of uniqueTrash) {
    for (const linker of await repos.pages.backlinks(id)) {
      if (excluded.has(linker.id)) continue;
      if (!affected.has(linker.id)) affected.set(linker.id, linker);
    }
  }
  return [...affected.values()].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

export interface TrashDuplicatesResult {
  keptId: string;
  trashedIds: string[];
  redirectedPages: number;
  redirectedLinks: number;
}

/**
 * Keeps `keepId`, redirects links pointing at `trashIds` to `keepId`, and moves
 * each copy in `trashIds` (and its sub-pages) to the trash so it stays restorable.
 */
export async function trashDuplicateCopies(
  repos: Repos,
  keepId: string,
  trashIds: readonly string[],
): Promise<TrashDuplicatesResult> {
  const kept = await repos.pages.get(keepId);
  if (!kept || kept.deleted_at) throw new Error('Kept page does not exist or is in the trash.');

  const validTrashIds: string[] = [];
  const seen = new Set<string>([keepId]);
  for (const id of trashIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = await repos.pages.get(id);
    if (!p || p.workspace_id !== kept.workspace_id || p.deleted_at) continue;
    validTrashIds.push(id);
  }

  if (!validTrashIds.length) {
    return { keptId: keepId, trashedIds: [], redirectedPages: 0, redirectedLinks: 0 };
  }

  // If the kept page happens to be nested under one of the copies being trashed,
  // move it above the highest trashed ancestor first so recursive trash keeps it live.
  const trashSet = new Set(validTrashIds);
  const keepAncestors = await repos.pages.ancestors(keepId);
  const strictAncestors = keepAncestors.slice(0, -1);
  const firstTrashedIdx = strictAncestors.findIndex((a) => trashSet.has(a.id));
  if (firstTrashedIdx !== -1) {
    const safeParentId = firstTrashedIdx > 0 ? strictAncestors[firstTrashedIdx - 1].id : null;
    await repos.pages.move(keepId, safeParentId);
  }

  // Redirect links from remaining live pages to the kept page before trashing copies.
  const idMap = new Map<string, string>(validTrashIds.map((id) => [id, keepId]));
  const linkers = await findAffectedBacklinks(repos, validTrashIds, keepId);
  const keptTitle = kept.title || 'Untitled';
  let redirectedPages = 0;
  let redirectedLinks = 0;

  for (const meta of linkers) {
    const full = await repos.pages.get(meta.id);
    if (!full || full.deleted_at || !full.content_json) continue;
    const doc = parseJson<DocNode | null>(full.content_json, null);
    if (!doc) continue;
    const { doc: rewritten, count } = rewriteDocPageLinks(doc, idMap, keptTitle);
    if (count > 0) {
      await repos.pages.saveContent(full.id, rewritten);
      redirectedPages++;
      redirectedLinks += count;
    }
  }

  const trashedIds: string[] = [];
  for (const id of validTrashIds) {
    const current = await repos.pages.get(id);
    if (current && !current.deleted_at) {
      await repos.pages.trash(id);
      trashedIds.push(id);
    }
  }

  return { keptId: keepId, trashedIds, redirectedPages, redirectedLinks };
}
