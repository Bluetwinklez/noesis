/** Helpers for walking Tiptap/ProseMirror JSON without an editor instance. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'taskItem',
  'tableCell',
  'tableHeader',
  'callout',
  'detailsSummary',
  'blockMath',
]);

export const PAGE_LINK_PREFIX = 'noesis://page/';

export interface DocExtract {
  text: string;
  linkedPageIds: string[];
}

export function extractDoc(doc: DocNode | null | undefined): DocExtract {
  const parts: string[] = [];
  const links = new Set<string>();
  const walk = (node: DocNode) => {
    if (node.type === 'text' && node.text) {
      parts.push(node.text);
      for (const m of node.marks ?? []) {
        const href = m.type === 'link' ? String(m.attrs?.href ?? '') : '';
        if (href.startsWith(PAGE_LINK_PREFIX)) links.add(href.slice(PAGE_LINK_PREFIX.length));
      }
    }
    if (node.type === 'pageMention' && node.attrs?.id) {
      links.add(String(node.attrs.id));
      parts.push(String(node.attrs.label ?? ''));
    }
    if ((node.type === 'inlineMath' || node.type === 'blockMath') && node.attrs?.latex) {
      parts.push(String(node.attrs.latex));
    }
    if (node.type === 'bookmark' && node.attrs) parts.push(`${node.attrs.title ?? ''} ${node.attrs.url ?? ''}`);
    for (const c of node.content ?? []) walk(c);
    if (BLOCK_TYPES.has(node.type)) parts.push('\n');
  };
  if (doc) walk(doc);
  return {
    text: parts.join('').replace(/\n{3,}/g, '\n\n').trim(),
    linkedPageIds: [...links],
  };
}

export function emptyDoc(): DocNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** Builds a doc from plain paragraphs (used by templates, AI notes, tests). */
export function docFromParagraphs(paragraphs: string[]): DocNode {
  return {
    type: 'doc',
    content: paragraphs.map((p) => (p ? { type: 'paragraph', content: [{ type: 'text', text: p }] } : { type: 'paragraph' })),
  };
}
