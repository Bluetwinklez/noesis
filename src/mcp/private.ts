import type { DocNode } from '../core/doc';

const OPEN_RE = /<private>/i;
const CLOSE_RE = /<\/private>/i;

const INLINE_BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock', 'detailsSummary']);

interface StripState {
  inPrivate: boolean;
}

interface TextStripResult {
  text: string;
  touched: boolean;
  cutAtStart: boolean;
  cutAtEnd: boolean;
}

interface WalkResult {
  node: DocNode | null;
  touched: boolean;
  cutAtStart?: boolean;
  cutAtEnd?: boolean;
}

/** Returns true when `text` contains an opening `<private>` marker (case-insensitive). */
export function hasPrivateMarkers(text: string): boolean {
  return OPEN_RE.test(text);
}

function stripTextWithState(text: string, state: StripState): TextStripResult {
  if (!state.inPrivate && !OPEN_RE.test(text)) {
    return { text, touched: false, cutAtStart: false, cutAtEnd: false };
  }

  let out = '';
  let pos = 0;
  let cutAtStart = state.inPrivate;
  let cutAtEnd = false;

  while (pos < text.length) {
    if (state.inPrivate) {
      const rest = text.slice(pos);
      const m = CLOSE_RE.exec(rest);
      if (!m) {
        cutAtEnd = true;
        pos = text.length;
        break;
      }
      pos += m.index + m[0].length;
      state.inPrivate = false;
      cutAtEnd = pos === text.length;
    } else {
      const rest = text.slice(pos);
      const m = OPEN_RE.exec(rest);
      if (!m) {
        if (out.length > 0 && /[ \t]$/.test(out) && /^[ \t]/.test(rest)) {
          out += rest.slice(1);
        } else {
          out += rest;
        }
        pos = text.length;
        break;
      }
      const piece = rest.slice(0, m.index);
      if (piece.length === 0 && out.length === 0) {
        cutAtStart = true;
      } else if (out.length > 0 && /[ \t]$/.test(out) && /^[ \t]/.test(piece)) {
        out += piece.slice(1);
      } else {
        out += piece;
      }
      pos += m.index + m[0].length;
      state.inPrivate = true;
      cutAtEnd = true;
    }
  }

  return { text: out, touched: true, cutAtStart, cutAtEnd };
}

/**
 * Pure helper that removes `<private>...</private>` blocks (case-insensitive)
 * from plain text or Markdown. An unterminated `<private>` hides the remainder.
 */
export function stripPrivateText(text: string): string {
  if (!OPEN_RE.test(text)) return text;
  const state: StripState = { inPrivate: false };
  const res = stripTextWithState(text, state);
  let out = res.text;
  if (res.cutAtStart) out = out.replace(/^[ \t\r\n]+/, '');
  if (res.cutAtEnd) out = out.replace(/[ \t\r\n]+$/, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim() ? out : '';
}

function walkInlineChildren(
  children: DocNode[],
  state: StripState,
  preserveWhitespace: boolean,
): { nodes: DocNode[]; touched: boolean } {
  const items: { node: DocNode; cutAtStart: boolean; cutAtEnd: boolean }[] = [];
  let touched = state.inPrivate;
  let droppedSinceLast = false;

  for (const child of children) {
    const r = walkNode(child, state);
    if (r.touched) touched = true;
    if (!r.node) {
      droppedSinceLast = true;
      continue;
    }
    if (droppedSinceLast && items.length > 0) {
      items[items.length - 1].cutAtEnd = true;
    }
    items.push({
      node: r.node,
      cutAtStart: Boolean(r.cutAtStart) || droppedSinceLast,
      cutAtEnd: Boolean(r.cutAtEnd),
    });
    droppedSinceLast = false;
  }

  if (droppedSinceLast && items.length > 0) {
    items[items.length - 1].cutAtEnd = true;
  }

  if (!touched || preserveWhitespace) {
    return { nodes: items.map((i) => i.node), touched };
  }

  const cleaned: DocNode[] = [];
  for (let i = 0; i < items.length; i++) {
    let cur = items[i].node;
    if (cur.type === 'text' && cur.text) {
      let text = cur.text;
      if (cleaned.length === 0 && items[i].cutAtStart) {
        text = text.replace(/^[ \t]+/, '');
      } else if (cleaned.length > 0 && items[i].cutAtStart) {
        const prev = cleaned[cleaned.length - 1];
        if (prev.type === 'text' && prev.text && /[ \t]$/.test(prev.text) && /^[ \t]/.test(text)) {
          text = text.slice(1);
        }
      }
      if (i === items.length - 1 && items[i].cutAtEnd) {
        text = text.replace(/[ \t]+$/, '');
      }
      if (!text) continue;
      if (text !== cur.text) cur = { ...cur, text };
    }
    cleaned.push(cur);
  }

  if (cleaned.length > 0 && items.length > cleaned.length) {
    const last = cleaned[cleaned.length - 1];
    if (last.type === 'text' && last.text && /[ \t]+$/.test(last.text)) {
      const trimmed = last.text.replace(/[ \t]+$/, '');
      if (trimmed) cleaned[cleaned.length - 1] = { ...last, text: trimmed };
      else cleaned.pop();
    }
  }

  return { nodes: cleaned, touched };
}

function walkNode(node: DocNode, state: StripState): WalkResult {
  if (node.type === 'text') {
    const res = stripTextWithState(node.text ?? '', state);
    if (!res.text) {
      return { node: null, touched: res.touched || state.inPrivate, cutAtStart: res.cutAtStart, cutAtEnd: res.cutAtEnd };
    }
    if (!res.touched) return { node, touched: false };
    return { node: { ...node, text: res.text }, touched: true, cutAtStart: res.cutAtStart, cutAtEnd: res.cutAtEnd };
  }

  if (!Array.isArray(node.content)) {
    if (state.inPrivate) return { node: null, touched: true };
    return { node, touched: false };
  }

  if (INLINE_BLOCK_TYPES.has(node.type)) {
    const { nodes, touched } = walkInlineChildren(node.content, state, node.type === 'codeBlock');
    if (!touched) return { node, touched: false };
    if (nodes.length === 0) return { node: null, touched: true };
    if (nodes.every((c) => c.type === 'text' && !(c.text ?? '').trim())) return { node: null, touched: true };
    return { node: { ...node, content: nodes }, touched: true };
  }

  if (node.type === 'tableRow') {
    let touched = state.inPrivate;
    const rawCells: { orig: DocNode; kept: DocNode | null }[] = [];
    for (const child of node.content) {
      const r = walkNode(child, state);
      if (r.touched) touched = true;
      rawCells.push({ orig: child, kept: r.node });
    }
    if (!touched) return { node, touched: false };
    if (rawCells.every((c) => c.kept === null)) return { node: null, touched: true };
    const cells = rawCells.map((c) => c.kept ?? { ...c.orig, content: [{ type: 'paragraph' }] });
    return { node: { ...node, content: cells }, touched: true };
  }

  let touched = state.inPrivate;
  const kept: DocNode[] = [];
  for (const child of node.content) {
    const r = walkNode(child, state);
    if (r.touched) touched = true;
    if (r.node) kept.push(r.node);
  }
  if (!touched) return { node, touched: false };
  if (node.type === 'doc') return { node: { ...node, content: kept }, touched: true };
  if (kept.length === 0) return { node: null, touched: true };

  if ((node.type === 'listItem' || node.type === 'taskItem') && kept[0].type !== 'paragraph') {
    return { node: { ...node, content: [{ type: 'paragraph' }, ...kept] }, touched: true };
  }
  if (node.type === 'details') {
    const hasSummary = kept.some((c) => c.type === 'detailsSummary');
    const hasContent = kept.some((c) => c.type === 'detailsContent');
    const fixed = [...kept];
    if (!hasSummary) fixed.unshift({ type: 'detailsSummary' });
    if (!hasContent) fixed.push({ type: 'detailsContent', content: [{ type: 'paragraph' }] });
    return { node: { ...node, content: fixed }, touched: true };
  }

  return { node: { ...node, content: kept }, touched: true };
}

/**
 * Pure helper that strips `<private>...</private>` blocks from a TipTap/ProseMirror
 * document tree without mutating the input. Supports inline spans, multi-block spans,
 * and unterminated `<private>` markers (hiding the rest of the document).
 */
export function stripPrivate(doc: DocNode): DocNode;
export function stripPrivate(doc: DocNode | null | undefined): DocNode | null;
export function stripPrivate(doc: DocNode | null | undefined): DocNode | null {
  if (!doc) return null;
  const state: StripState = { inPrivate: false };
  const res = walkNode(doc, state);
  return res.node ?? { type: 'doc', content: [] };
}
