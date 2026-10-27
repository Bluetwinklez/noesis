/**
 * Direct PDF export built from the stored document tree (no print dialog). Text stays
 * selectable; headings, lists, tables, code, quotes, links and PNG/JPEG images are kept.
 * Uses the embedded Roboto font (Latin, Greek, Cyrillic, incl. Turkish); glyphs outside it
 * (emoji, CJK) are dropped, for those the print path with system fonts remains available.
 */
import type { DocNode } from '../core/doc';
import type { ImageLoader } from './docx';

// Minimal shapes of pdfmake's document definition (we only build plain objects).
type Content = string | Record<string, unknown> | Content[];

const HEADING_SIZE = [22, 18, 15, 13, 12, 11];
const PAGE_WIDTH = 595.28 - 2 * 50; // A4 minus margins, in points
const LINE = '#D6D3CC';

function runs(nodes: DocNode[] | undefined, extra: Record<string, unknown> = {}): Content[] {
  const out: Content[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') out.push({ text: '\n' });
    else if (n.type === 'pageMention') out.push({ text: `@${String(n.attrs?.label ?? 'page')}`, color: '#5B5BD6', ...extra });
    else if (n.type === 'inlineMath') out.push({ text: String(n.attrs?.latex ?? ''), color: '#555555', ...extra });
    else if (n.type === 'text' && n.text) {
      const m = new Set((n.marks ?? []).map((x) => x.type));
      const decoration = [m.has('underline') && 'underline', m.has('strike') && 'lineThrough'].filter(Boolean);
      const link = n.marks?.find((x) => x.type === 'link')?.attrs?.href;
      out.push({
        text: n.text,
        ...(m.has('bold') && { bold: true }),
        ...(m.has('italic') && { italics: true }),
        ...(decoration.length && { decoration: decoration.length === 1 ? decoration[0] : decoration }),
        ...(m.has('code') && { background: '#F3F1EC', color: '#B4373B' }),
        ...(m.has('highlight') && { background: '#FFF3A3' }),
        ...(typeof link === 'string' && /^(https?:|mailto:)/i.test(link) && { link, color: '#2F5FD0', decoration: 'underline' }),
        ...extra,
      });
    }
  }
  return out;
}

/** A one-cell table used for quotes, callouts and code: left rule and/or a tint. */
const boxed = (stack: Content[], o: { rule?: string; fill?: string }) => ({
  table: { widths: ['*'], body: [[{ stack, ...(o.fill && { fillColor: o.fill }) }]] },
  layout: {
    hLineWidth: () => 0,
    vLineWidth: (i: number) => (i === 0 && o.rule ? 2.5 : 0),
    vLineColor: () => o.rule ?? LINE,
    paddingLeft: () => 9,
    paddingRight: () => 8,
    paddingTop: () => 5,
    paddingBottom: () => 5,
  },
  margin: [0, 2, 0, 8],
});

async function blocks(nodes: DocNode[] | undefined, load: ImageLoader): Promise<Content[]> {
  const out: Content[] = [];
  for (const n of nodes ?? []) {
    const b = await block(n, load);
    if (b !== null) out.push(b);
  }
  return out;
}

async function block(n: DocNode, load: ImageLoader): Promise<Content | null> {
  switch (n.type) {
    case 'paragraph':
      return { text: n.content?.length ? runs(n.content) : ' ', margin: [0, 0, 0, 6] };
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1)));
      return { text: runs(n.content), fontSize: HEADING_SIZE[level - 1], bold: true, margin: [0, level <= 2 ? 12 : 8, 0, 4] };
    }
    case 'bulletList':
    case 'orderedList': {
      const items = await Promise.all((n.content ?? []).map(async (li) => ({ stack: await blocks(li.content, load) })));
      return { [n.type === 'orderedList' ? 'ol' : 'ul']: items, margin: [0, 0, 0, 6] };
    }
    case 'taskList': {
      const items = await Promise.all(
        (n.content ?? []).map(async (item) => {
          const [first, ...rest] = item.content ?? [];
          const done = !!item.attrs?.checked;
          return {
            stack: [
              { text: [{ text: done ? '[x] ' : '[ ] ', color: '#888888' }, ...runs(first?.content, done ? { decoration: 'lineThrough', color: '#888888' } : {})] },
              ...(await blocks(rest, load)),
            ],
            margin: [0, 0, 0, 2],
          };
        }),
      );
      return { stack: items, margin: [0, 0, 0, 6] };
    }
    case 'blockquote':
      return { ...boxed(await blocks(n.content, load), { rule: '#BBBBBB' }), italics: true };
    case 'callout':
      return boxed(await blocks(n.content, load), { rule: '#7C8CF8', fill: '#EEF1FF' });
    case 'codeBlock': {
      const code = n.content?.map((c) => c.text ?? '').join('') ?? '';
      return boxed([{ text: code || ' ', fontSize: 9, preserveLeadingSpaces: true, lineHeight: 1.15 }], { fill: '#F3F1EC' });
    }
    case 'horizontalRule':
      return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: PAGE_WIDTH, y2: 0, lineWidth: 0.6, lineColor: LINE }], margin: [0, 6, 0, 10] };
    case 'blockMath':
      return { text: String(n.attrs?.latex ?? ''), alignment: 'center', color: '#555555', margin: [0, 4, 0, 8] };
    case 'details':
    case 'detailsContent':
      return { stack: await blocks(n.content, load) };
    case 'detailsSummary':
      return { text: runs(n.content), bold: true, margin: [0, 0, 0, 4] };
    case 'bookmark':
    case 'fileAttachment': {
      const url = String(n.attrs?.url ?? '');
      const label = String(n.attrs?.title ?? n.attrs?.name ?? url);
      return /^https?:/i.test(url) ? { text: label, link: url, color: '#2F5FD0', decoration: 'underline', margin: [0, 0, 0, 6] } : { text: `[${label}]`, margin: [0, 0, 0, 6] };
    }
    case 'image': {
      const img = await load(String(n.attrs?.src ?? '')).catch(() => null);
      if (!img || (img.type !== 'png' && img.type !== 'jpg'))
        return { text: `[${String(n.attrs?.alt || 'image')}]`, italics: true, color: '#888888', margin: [0, 0, 0, 6] };
      const width = Math.min(PAGE_WIDTH, img.width * 0.75); // px → pt
      return { image: `data:image/${img.type === 'jpg' ? 'jpeg' : 'png'};base64,${base64(img.bytes)}`, width, margin: [0, 2, 0, 8] };
    }
    case 'table': {
      const rows = (n.content ?? []).filter((r) => r.type === 'tableRow');
      if (!rows.length) return null;
      const cols = Math.max(...rows.map((r) => r.content?.length ?? 0));
      if (!cols) return null;
      const body = await Promise.all(
        rows.map(async (r) => {
          const cells = await Promise.all(
            (r.content ?? []).map(async (c) => ({ stack: await blocks(c.content, load), ...(c.type === 'tableHeader' && { fillColor: '#F1EFEA', bold: true }) })),
          );
          while (cells.length < cols) cells.push({ stack: [] });
          return cells;
        }),
      );
      const header = rows[0].content?.every((c) => c.type === 'tableHeader') ? 1 : 0;
      return {
        table: { headerRows: header, widths: Array(cols).fill('*'), body },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.6, vLineWidth: () => 0.6, paddingTop: () => 4, paddingBottom: () => 0 },
        margin: [0, 2, 0, 10],
      };
    }
    default:
      return n.content ? { stack: await blocks(n.content, load) } : n.text ? { text: n.text } : null;
  }
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The pdfmake document definition (pure, so it is unit-tested directly). */
export async function docToPdfDefinition(title: string, doc: DocNode | null, loadImage: ImageLoader = async () => null) {
  return {
    info: { title, creator: 'Noesis' },
    pageSize: 'A4',
    pageMargins: [50, 50, 50, 56],
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.3, color: '#1F1E1C' },
    footer: (page: number, pages: number) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 8, color: '#999999', margin: [0, 20, 0, 0] }),
    content: [{ text: title || 'Untitled', fontSize: 26, bold: true, margin: [0, 0, 0, 14] }, ...(await blocks(doc?.content, loadImage))],
  };
}

interface PdfMake {
  addVirtualFileSystem(vfs: Record<string, string>): void;
  createPdf(def: unknown): { getBuffer(): Promise<Uint8Array> };
}

export async function docToPdf(title: string, doc: DocNode | null, loadImage?: ImageLoader): Promise<Uint8Array> {
  const [{ default: pdfMake }, { default: vfs }] = (await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])) as unknown as [
    { default: PdfMake },
    { default: Record<string, string> },
  ];
  pdfMake.addVirtualFileSystem(vfs);
  return new Uint8Array(await pdfMake.createPdf(await docToPdfDefinition(title, doc, loadImage)).getBuffer());
}
