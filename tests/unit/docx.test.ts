import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { docToDocx } from '../../src/editor/docx';
import type { DocNode } from '../../src/core/doc';

const PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const text = (t: string, marks?: string[]) => ({ type: 'text', text: t, marks: marks?.map((type) => ({ type })) });

describe('DOCX export', () => {
  it('produces a valid Word document with native formatting', async () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [text('Results')] },
        { type: 'paragraph', content: [text('Plain '), text('bold', ['bold']), { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('first')] }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('step one')] }] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [text('done task')] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [text('quoted')] }] },
        { type: 'codeBlock', content: [text('const x = 1;\nreturn x;')] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [text('Col A')] }] }] }] },
        { type: 'image', attrs: { src: 'attachment:1', alt: 'pic' } },
        { type: 'image', attrs: { src: 'attachment:missing', alt: 'gone' } },
      ],
    };
    const bytes = await docToDocx('Report', doc, async (src) => (src === 'attachment:1' ? { bytes: PNG_1x1, type: 'png', width: 1, height: 1 } : null));
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    for (const s of ['Report', 'Results', 'bold', 'first', 'step one', '☑ ', 'done task', 'quoted', 'const x = 1;', 'return x;', 'Col A', '[gone]']) expect(xml).toContain(s);
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('w:hyperlink');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Heading2');
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
    expect(await zip.file('word/numbering.xml')?.async('string')).toContain('decimal');
  });
});
