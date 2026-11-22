// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { docFromParagraphs, extractDoc, type DocNode } from '../../src/core/doc';
import { htmlToMarkdown } from '../../src/editor/markdown';
import { docToHtml } from '../../src/editor/serialize';
import { hasPrivateMarkers, stripPrivate, stripPrivateText } from '../../src/mcp/private';

describe('MCP private block stripping', () => {
  it('detects private markers case-insensitively and leaves clean text untouched', () => {
    expect(hasPrivateMarkers('Normal note')).toBe(false);
    expect(hasPrivateMarkers('With <private>secret</private>')).toBe(true);
    expect(hasPrivateMarkers('With <PRIVATE>secret</PRIVATE>')).toBe(true);
    expect(stripPrivateText('  Keep   spacing\n\nunchanged  ')).toBe('  Keep   spacing\n\nunchanged  ');
  });

  it('strips inline private blocks in a single paragraph without leaving stray spaces', () => {
    const doc = docFromParagraphs(['Public before <private>api-key-123</private> public after.']);
    const cleaned = stripPrivate(doc);
    expect(extractDoc(cleaned).text).toBe('Public before public after.');
    expect(htmlToMarkdown(docToHtml(cleaned)).trim()).toBe('Public before public after.');
    // Original doc is not mutated.
    expect(extractDoc(doc).text).toContain('api-key-123');
  });

  it('strips multiple and case-insensitive private spans inside one paragraph and across marks', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Start ' },
            { type: 'text', text: '<Private>secret one', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' still secret</PRIVATE> middle <private>secret two</private> end' },
          ],
        },
      ],
    };
    const cleaned = stripPrivate(doc);
    const md = htmlToMarkdown(docToHtml(cleaned)).trim();
    expect(md).toBe('Start middle end');
    expect(md).not.toContain('secret');
  });

  it('strips private blocks spanning multiple paragraphs, headings, lists and atom nodes', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Intro paragraph' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep prefix <private>hidden tail' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Secret Heading' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Secret bullet' }] }] },
          ],
        },
        { type: 'bookmark', attrs: { url: 'https://secret.example/token', title: 'Secret Link' } },
        { type: 'blockMath', attrs: { latex: 'x_{secret} = 42' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hidden end</private> Visible suffix' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Outro paragraph' }] },
      ],
    };

    const cleaned = stripPrivate(doc);
    const text = extractDoc(cleaned).text;
    const md = htmlToMarkdown(docToHtml(cleaned));

    expect(text).toContain('Intro paragraph');
    expect(text).toContain('Keep prefix');
    expect(text).toContain('Visible suffix');
    expect(text).toContain('Outro paragraph');
    for (const leaked of ['hidden tail', 'Secret Heading', 'Secret bullet', 'secret.example', 'x_{secret}', 'hidden end', '<private>', '</private>']) {
      expect(text).not.toContain(leaked);
      expect(md).not.toContain(leaked);
    }
  });

  it('drops standalone marker paragraphs and keeps table structure valid when a single cell is private', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '<private>' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Vault PIN 9876' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '</private>' }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Field' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Value' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Token' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<private>tok_live_xyz</private>' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<private>HiddenRowA' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'HiddenRowB</private>' }] }] },
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    };

    const cleaned = stripPrivate(doc);
    const md = htmlToMarkdown(docToHtml(cleaned));
    expect(md).toContain('Before');
    expect(md).toContain('Token');
    expect(md).toContain('After');
    expect(md).not.toContain('9876');
    expect(md).not.toContain('tok_live_xyz');
    expect(md).not.toContain('HiddenRow');
  });

  it('treats an unterminated <private> as hiding the rest of the document and text', () => {
    const doc = docFromParagraphs([
      'First public line',
      'Second line <private>starts secret',
      'Third paragraph also hidden',
      'Fourth paragraph also hidden',
    ]);
    const cleaned = stripPrivate(doc);
    const md = htmlToMarkdown(docToHtml(cleaned));
    expect(md).toContain('First public line');
    expect(md).toContain('Second line');
    expect(md).not.toContain('starts secret');
    expect(md).not.toContain('Third paragraph');
    expect(md).not.toContain('Fourth paragraph');

    expect(stripPrivateText('Keep this <private>drop everything\neven next line')).toBe('Keep this');
    expect(stripPrivateText('<private>all secret')).toBe('');
  });

  it('handles null, undefined, and completely private documents safely', () => {
    expect(stripPrivate(null)).toBeNull();
    expect(stripPrivate(undefined)).toBeNull();
    const allPrivate = docFromParagraphs(['<private>only secret text</private>']);
    const cleaned = stripPrivate(allPrivate);
    expect(cleaned).toEqual({ type: 'doc', content: [] });
    expect(extractDoc(cleaned).text).toBe('');
  });

  it('strips multi-line blocks cleanly in plain text', () => {
    const input = 'Line 1\n<private>\nSecret line A\nSecret line B\n</private>\nLine 2';
    expect(stripPrivateText(input)).toBe('Line 1\n\nLine 2');
    expect(stripPrivateText('<private>secret</private> trailing')).toBe('trailing');
    expect(stripPrivateText('leading <private>secret</private>')).toBe('leading');
    expect(stripPrivateText('a <private>1</private> b <private>2</private> c')).toBe('a b c');
  });
});
