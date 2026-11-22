import { extractDoc, type DocNode } from './doc';

export const MAX_MERGED_HEADING_LEVEL = 4;

export interface MergePagesOptions {
  /** Fallback title used for untitled pages when building section headings. Default: 'Untitled'. */
  untitledLabel?: string;
}

export interface MergePagesResult {
  targetId: string;
  targetTitle: string;
  mergedSourceIds: string[];
  mergedSourceTitles: string[];
  movedSubpageCount: number;
  redirectedPages: number;
  redirectedLinks: number;
  totalSourceChars: number;
}

function normalizeHeadingText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isEmptyParagraph(node: DocNode): boolean {
  if (node.type !== 'paragraph') return false;
  if (!node.content || node.content.length === 0) return true;
  return node.content.every((c) => c.type === 'text' && (!c.text || !c.text.trim()));
}

/** Demotes a heading level by one, capped at `maxLevel` (default 4). */
export function demoteHeadingLevel(level: number, maxLevel = MAX_MERGED_HEADING_LEVEL): number {
  const current = Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
  return Math.min(maxLevel, current + 1);
}

/**
 * Recursively demotes every heading node inside `node` by one level (capped at `maxLevel`)
 * without mutating the input document.
 */
export function demoteHeadings(node: DocNode, maxLevel = MAX_MERGED_HEADING_LEVEL): DocNode {
  const nextContent = node.content?.map((child) => demoteHeadings(child, maxLevel));
  if (node.type === 'heading') {
    const level = demoteHeadingLevel(Number(node.attrs?.level ?? 1), maxLevel);
    return {
      ...node,
      attrs: { ...node.attrs, level },
      ...(nextContent !== undefined ? { content: nextContent } : {}),
    };
  }
  return {
    ...node,
    ...(nextContent !== undefined ? { content: nextContent } : {}),
  };
}

/**
 * Prepares a source page's top-level blocks for appending under a level-2 section heading:
 * - skips a leading H1 whose text matches `sourceTitle` (case-insensitive, normalised whitespace),
 * - demotes all remaining headings by one level, capped at level 4.
 */
export function prepareSourceBlocks(doc: DocNode | null, sourceTitle: string): DocNode[] {
  let blocks = doc?.content ? [...doc.content] : [];
  if (blocks.length > 0 && blocks[0].type === 'heading') {
    const firstLevel = Number(blocks[0].attrs?.level ?? 1);
    const normTitle = normalizeHeadingText(sourceTitle);
    if (firstLevel === 1 && normTitle.length > 0 && normalizeHeadingText(extractDoc(blocks[0]).text) === normTitle) {
      blocks = blocks.slice(1);
    }
  }
  if (blocks.length === 1 && isEmptyParagraph(blocks[0])) {
    return [];
  }
  return blocks.map((b) => demoteHeadings(b));
}

/**
 * Builds the merged TipTap document by appending each source's prepared body under a level-2
 * heading bearing the source's title, preserving the order of `sources`.
 */
export function buildMergedDoc(
  targetDoc: DocNode | null,
  sources: readonly { title: string; doc: DocNode | null }[],
  untitledLabel = 'Untitled',
): DocNode {
  let targetBlocks = targetDoc?.content ? [...targetDoc.content] : [];
  if (targetBlocks.length === 1 && isEmptyParagraph(targetBlocks[0])) {
    targetBlocks = [];
  }

  const combined: DocNode[] = [...targetBlocks];
  for (const src of sources) {
    const headingText = src.title.trim() || untitledLabel;
    combined.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: headingText }],
    });
    combined.push(...prepareSourceBlocks(src.doc, src.title));
  }

  return {
    type: 'doc',
    content: combined.length > 0 ? combined : [{ type: 'paragraph' }],
  };
}
