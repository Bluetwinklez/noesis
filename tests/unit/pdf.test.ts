import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { docToPdfDefinition } from '../../src/editor/pdf';
import type { DocNode } from '../../src/core/doc';

const PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const text = (t: string, marks?: string[]) => ({ type: 'text', text: t, marks: marks?.map((type) => ({ type })) });

const doc: DocNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('Sonuçlar')] },
    { type: 'paragraph', content: [text('Düz '), text('kalın', ['bold']), { type: 'text', text: 'bağlantı', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('first')] }] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('step one')] }] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [text('done task')] }] }] },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [text('quoted')] }] },
    { type: 'codeBlock', content: [text('const x = 1;\n  return x;')] },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [text('Col A')] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [text('Col B')] }] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [text('short row')] }] }] },
    ] },
    { type: 'horizontalRule' },
    { type: 'image', attrs: { src: 'attachment:1', alt: 'pic' } },
    { type: 'image', attrs: { src: 'attachment:missing', alt: 'gone' } },
  ],
};
const load = async (src: string) => (src === 'attachment:1' ? { bytes: PNG_1x1, type: 'png' as const, width: 1, height: 1 } : null);

describe('PDF export', () => {
  it('maps the document to a pdfmake definition', async () => {
    const def = await docToPdfDefinition('Rapor', doc, load);
    const json = JSON.stringify(def.content);
    expect(def.content[0]).toMatchObject({ text: 'Rapor', bold: true });
    expect(json).toContain('"ul"');
    expect(json).toContain('"ol"');
    expect(json).toContain('[x] ');
    expect(json).toContain('"link":"https://example.com"');
    expect(json).toContain('data:image/png;base64,');
    expect(json).toContain('[gone]');
    // The short table row is padded so every row has the same number of cells.
    const table = (def.content as { table?: { body: unknown[][]; headerRows: number } }[]).find((c) => c.table && "headerRows" in c.table)!.table!;
    expect(table.body.map((r) => r.length)).toEqual([2, 2]);
    expect(table.headerRows).toBe(1);
  });

  it('renders a real PDF with selectable Turkish text', async () => {
    const require = createRequire(import.meta.url);
    const pdfmake = require('pdfmake');
    const fonts = join(dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
    pdfmake.addFonts({ Roboto: { normal: join(fonts, 'Roboto-Regular.ttf'), bold: join(fonts, 'Roboto-Medium.ttf'), italics: join(fonts, 'Roboto-Italic.ttf'), bolditalics: join(fonts, 'Roboto-MediumItalic.ttf') } });
    pdfmake.setUrlAccessPolicy?.(() => false);
    const bytes: Uint8Array = await pdfmake.createPdf(await docToPdfDefinition('Rapor', doc, load)).getBuffer();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const page = await pdf.getPage(1);
    const content = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
    for (const s of ['Rapor', 'Sonuçlar', 'kalın', 'bağlantı', 'step one', 'done task', 'quoted', 'return x;', 'Col B', 'short row']) expect(content).toContain(s);
  });
});
