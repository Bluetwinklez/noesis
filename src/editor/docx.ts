/**
 * Word (.docx) export built from the stored document tree, so headings, lists,
 * tables, code, quotes and inline formatting become native Word formatting.
 * Images stored as attachments are embedded; anything unsupported degrades to text.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import type { DocNode } from '../core/doc';

export type ImageLoader = (src: string) => Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number } | null>;

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const MONO = 'Cascadia Mono';

interface Ctx {
  loadImage: ImageLoader;
  /** Depth inside bullet/ordered lists (0 = not in a list). */
  listLevel: number;
  listKind: 'bullet' | 'ordered' | null;
}

function textRuns(nodes: DocNode[] | undefined, extra: Partial<IRunOptions> = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (n.type === 'pageMention') {
      out.push(new TextRun({ text: `@${String(n.attrs?.label ?? 'page')}`, color: '5B5BD6', ...extra }));
      continue;
    }
    if (n.type === 'inlineMath') {
      out.push(new TextRun({ text: String(n.attrs?.latex ?? ''), font: MONO, ...extra }));
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const m = new Set((n.marks ?? []).map((x) => x.type));
    const opts: IRunOptions = {
      text: n.text,
      bold: m.has('bold') || undefined,
      italics: m.has('italic') || undefined,
      underline: m.has('underline') ? {} : undefined,
      strike: m.has('strike') || undefined,
      font: m.has('code') ? MONO : undefined,
      highlight: m.has('highlight') ? 'yellow' : undefined,
      ...extra,
    };
    const link = n.marks?.find((x) => x.type === 'link')?.attrs?.href;
    if (typeof link === 'string' && /^(https?:|mailto:)/i.test(link)) {
      out.push(new ExternalHyperlink({ link, children: [new TextRun({ ...opts, style: 'Hyperlink' })] }));
    } else out.push(new TextRun(opts));
  }
  return out;
}

async function blocks(nodes: DocNode[] | undefined, ctx: Ctx): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [];
  for (const n of nodes ?? []) out.push(...(await block(n, ctx)));
  return out;
}

async function block(n: DocNode, ctx: Ctx): Promise<(Paragraph | Table)[]> {
  const listProps = ctx.listKind ? { numbering: { reference: ctx.listKind === 'ordered' ? 'ordered' : 'bullet', level: Math.min(ctx.listLevel - 1, 8) } } : {};
  switch (n.type) {
    case 'paragraph':
      return [new Paragraph({ children: textRuns(n.content), ...listProps })];
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1)));
      return [new Paragraph({ heading: HEADINGS[level - 1], children: textRuns(n.content) })];
    }
    case 'bulletList':
    case 'orderedList': {
      const inner: Ctx = { ...ctx, listLevel: ctx.listLevel + 1, listKind: n.type === 'orderedList' ? 'ordered' : 'bullet' };
      return blocks(n.content, inner);
    }
    case 'listItem':
      return blocks(n.content, ctx);
    case 'taskList':
      return blocks(n.content, { ...ctx, listLevel: ctx.listLevel + 1, listKind: null });
    case 'taskItem': {
      const [first, ...rest] = n.content ?? [];
      const box = n.attrs?.checked ? '☑ ' : '☐ ';
      const head = new Paragraph({ indent: { left: 360 * ctx.listLevel }, children: [new TextRun(box), ...textRuns(first?.content)] });
      return [head, ...(await blocks(rest, ctx))];
    }
    case 'blockquote':
    case 'callout': {
      // Paragraphs inside get a left rule (and a tint for callouts); nested blocks render normally.
      const quoteProps = {
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: n.type === 'callout' ? '7C8CF8' : 'BBBBBB', space: 8 } },
        shading: n.type === 'callout' ? { type: ShadingType.CLEAR, fill: 'EEF1FF', color: 'auto' } : undefined,
      };
      const out: (Paragraph | Table)[] = [];
      for (const child of n.content ?? []) {
        if (child.type === 'paragraph') out.push(new Paragraph({ ...quoteProps, children: textRuns(child.content, n.type === 'blockquote' ? { italics: true } : {}) }));
        else out.push(...(await block(child, { ...ctx, listKind: null })));
      }
      return out;
    }
    case 'codeBlock':
      return (n.content?.map((c) => c.text ?? '').join('') ?? '').split('\n').map(
        (line) =>
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: 'F3F1EC', color: 'auto' },
            spacing: { after: 0 },
            children: [new TextRun({ text: line || ' ', font: MONO, size: 19 })],
          }),
      );
    case 'horizontalRule':
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } }, children: [] })];
    case 'blockMath':
      return [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(n.attrs?.latex ?? ''), font: MONO })] })];
    case 'details':
      return blocks(n.content, ctx);
    case 'detailsSummary':
      return [new Paragraph({ children: textRuns(n.content, { bold: true }) })];
    case 'detailsContent':
      return blocks(n.content, ctx);
    case 'bookmark':
    case 'fileAttachment': {
      const url = String(n.attrs?.url ?? '');
      const label = String(n.attrs?.title ?? n.attrs?.name ?? url);
      return [
        new Paragraph({
          children: /^https?:/i.test(url) ? [new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, style: 'Hyperlink' })] })] : [new TextRun({ text: `📎 ${label}` })],
        }),
      ];
    }
    case 'image': {
      const src = String(n.attrs?.src ?? '');
      const img = await ctx.loadImage(src).catch(() => null);
      if (!img) return [new Paragraph({ children: [new TextRun({ text: `[${String(n.attrs?.alt ?? 'image')}]`, italics: true })] })];
      const maxW = 600;
      const scale = Math.min(1, maxW / Math.max(1, img.width));
      return [
        new Paragraph({
          children: [new ImageRun({ type: img.type, data: img.bytes, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) } })],
        }),
      ];
    }
    case 'table': {
      const rows = (n.content ?? []).filter((r) => r.type === 'tableRow');
      if (!rows.length) return [];
      const tableRows = await Promise.all(
        rows.map(
          async (r) =>
            new TableRow({
              children: await Promise.all(
                (r.content ?? []).map(async (cell) => {
                  const content = await blocks(cell.content, { ...ctx, listKind: null, listLevel: 0 });
                  return new TableCell({
                    children: content.length ? content : [new Paragraph('')],
                    shading: cell.type === 'tableHeader' ? { type: ShadingType.CLEAR, fill: 'F1EFEA', color: 'auto' } : undefined,
                  });
                }),
              ),
            }),
        ),
      );
      return [new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } })];
    }
    default:
      // Unknown block with children: keep its text rather than dropping it.
      return n.content ? blocks(n.content, ctx) : n.text ? [new Paragraph(n.text)] : [];
  }
}

const levels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (i: number) => string) =>
  Array.from({ length: 9 }, (_, i) => ({ level: i, format, text: text(i), alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (i + 1), hanging: 260 } } } }));

export async function docToDocx(title: string, doc: DocNode | null, loadImage: ImageLoader = async () => null): Promise<Uint8Array> {
  const body = await blocks(doc?.content, { loadImage, listLevel: 0, listKind: null });
  const file = new Document({
    title,
    creator: 'Noesis',
    styles: { default: { document: { run: { font: 'Segoe UI', size: 22 } } } },
    numbering: {
      config: [
        { reference: 'bullet', levels: levels(LevelFormat.BULLET, (i) => ['•', '◦', '▪'][i % 3]) },
        { reference: 'ordered', levels: levels(LevelFormat.DECIMAL, (i) => `%${i + 1}.`) },
      ],
    },
    sections: [{ children: [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }), ...body] }],
  });
  return new Uint8Array(await (await Packer.toBlob(file)).arrayBuffer());
}
