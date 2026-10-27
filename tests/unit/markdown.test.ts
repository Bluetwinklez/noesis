// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, markdownToHtml } from '../../src/editor/markdown';

describe('markdown paste', () => {
  it('detects block-level markdown but not ordinary prose', () => {
    expect(looksLikeMarkdown('# Title\n\nBody')).toBe(true);
    expect(looksLikeMarkdown('## Only a heading')).toBe(true);
    expect(looksLikeMarkdown('Intro\n- one\n- two')).toBe(true);
    expect(looksLikeMarkdown('Steps:\n1. first\n2. second')).toBe(true);
    expect(looksLikeMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true);
    expect(looksLikeMarkdown('```\ncode\n```')).toBe(true);
    expect(looksLikeMarkdown('Just a sentence with *emphasis*.')).toBe(false);
    expect(looksLikeMarkdown('Line one\nLine two')).toBe(false);
    expect(looksLikeMarkdown('')).toBe(false);
  });

  it('converts task lists and strips unsafe HTML', () => {
    const html = markdownToHtml('- [x] done\n- [ ] todo\n\n<script>alert(1)</script>');
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(html).not.toContain('<script');
  });
});

describe('i18n', () => {
  it('interpolates plural forms', async () => {
    const { translate } = await import('../../src/i18n');
    expect(translate('en', 'nb.sourceCount', { n: 1 })).toBe('1 source');
    expect(translate('en', 'nb.sourceCount', { n: 3 })).toBe('3 sources');
    expect(translate('tr', 'nb.sourceCount', { n: 3 })).toBe('3 kaynak');
  });
});
