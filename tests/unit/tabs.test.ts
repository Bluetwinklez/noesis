// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { closeTab, normalizeTabs, openTab, type PageTabs } from '../../src/app/tabs';
import { docToHtml, htmlToDoc } from '../../src/editor/serialize';
import { htmlToMarkdown, markdownToHtml } from '../../src/editor/markdown';

describe('page tabs', () => {
  it('deduplicates, limits and rejects stale restored pages', () => {
    expect(normalizeTabs({ ids: ['a', 'a', 'missing', 'b'], active: 'missing', split: 'b' }, new Set(['a', 'b']))).toEqual({ ids: ['a', 'b'], active: 'a', split: 'b' });
  });
  it('opens without duplicates and chooses a neighbour on close', () => {
    const tabs: PageTabs = { ids: ['a', 'b'], active: 'a', split: 'b' };
    expect(openTab(tabs, 'b')).toEqual({ ids: ['a', 'b'], active: 'b', split: null });
    expect(closeTab(tabs, 'a')).toEqual({ ids: ['b'], active: 'b', split: null });
  });
});

it('keeps a table-of-contents block through HTML and Markdown transfer', () => {
  const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Heading' }] }, { type: 'tableOfContents' }] };
  const markdown = htmlToMarkdown(docToHtml(doc));
  expect(htmlToDoc(markdownToHtml(markdown)).content?.some((node) => node.type === 'tableOfContents')).toBe(true);
});
