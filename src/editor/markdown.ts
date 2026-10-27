import { marked } from 'marked';
import TurndownService from 'turndown';
// @ts-expect-error -- package ships without types
import { gfm } from 'turndown-plugin-gfm';
import DOMPurify from 'dompurify';
import { PAGE_LINK_PREFIX } from '../core/doc';

/**
 * Heuristic used on paste: true when plain text carries block-level markdown
 * (headings, lists, quotes, fences, tables) that should become real blocks.
 * Inline-only syntax such as a lone *word* is left as typed text.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2 && !/^#{1,6}\s/.test(text)) return false;
  const block = /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|```|\|.*\|\s*$|\s*[-*+]\s\[[ xX]\]\s)/;
  return lines.filter((l) => block.test(l)).length >= 1 && lines.some((l) => l.trim().length > 0);
}

/** Markdown → sanitized HTML that the editor can load. Task lists become Tiptap task lists. */
export function markdownToHtml(md: string): string {
  const raw = marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
  const clean = DOMPurify.sanitize(raw, {
    ADD_ATTR: ['data-type', 'data-checked'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'form'],
    // DOMPurify's default list plus the app's own internal schemes (page links, stored images).
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|noesis|attachment):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
  if (typeof DOMParser === 'undefined') return clean;
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html');
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI');
    if (!items.length || !items.every((li) => li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]'))) return;
    ul.setAttribute('data-type', 'taskList');
    for (const li of items) {
      const box = li.querySelector('input[type=checkbox]') as HTMLInputElement;
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false');
      box.remove();
    }
  });
  // Math: $$...$$ blocks and $...$ inline
  return doc.body.innerHTML
    .replace(/<p>\$\$([\s\S]+?)\$\$<\/p>/g, (_m, l) => `<div data-type="block-math" data-latex="${escapeAttr(l.trim())}"></div>`)
    .replace(/(^|[^\\$])\$([^$\n]{1,200}?)\$/g, (_m, pre, l) => `${pre}<span data-type="inline-math" data-latex="${escapeAttr(l)}"></span>`);
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

let td: TurndownService | null = null;
function turndown(): TurndownService {
  if (td) return td;
  td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
  td.use(gfm);
  td.addRule('taskItem', {
    filter: (n) => n.nodeName === 'LI' && (n as HTMLElement).getAttribute('data-type') === 'taskItem',
    replacement: (content, n) => `- [${(n as HTMLElement).getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${content.trim().replace(/\n+/g, ' ')}\n`,
  });
  td.addRule('taskList', {
    filter: (n) => n.nodeName === 'UL' && (n as HTMLElement).getAttribute('data-type') === 'taskList',
    replacement: (content) => `\n${content}\n`,
  });
  td.addRule('callout', {
    filter: (n) => (n as HTMLElement).getAttribute?.('data-type') === 'callout',
    replacement: (content) => `\n${content.trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`,
  });
  td.addRule('mathBlock', {
    filter: (n) => (n as HTMLElement).getAttribute?.('data-type') === 'block-math',
    replacement: (_c, n) => `\n$$${(n as HTMLElement).getAttribute('data-latex')}$$\n`,
  });
  td.addRule('mathInline', {
    filter: (n) => (n as HTMLElement).getAttribute?.('data-type') === 'inline-math',
    replacement: (_c, n) => `$${(n as HTMLElement).getAttribute('data-latex')}$`,
  });
  td.addRule('mention', {
    filter: (n) => (n as HTMLElement).getAttribute?.('data-type') === 'page-mention',
    replacement: (content, n) => `[${content}](${PAGE_LINK_PREFIX}${(n as HTMLElement).getAttribute('data-id')})`,
  });
  td.addRule('bookmark', {
    filter: (n) => (n as HTMLElement).getAttribute?.('data-type') === 'bookmark',
    replacement: (content, n) => `\n[${content || (n as HTMLElement).getAttribute('data-url')}](${(n as HTMLElement).getAttribute('data-url')})\n`,
  });
  td.addRule('details', {
    filter: ['details'],
    replacement: (content) => `\n${content}\n`,
  });
  return td;
}

export function htmlToMarkdown(html: string): string {
  return turndown().turndown(html).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function standaloneHtml(title: string, bodyHtml: string): string {
  const safeTitle = title.replace(/</g, '&lt;');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
body{font-family:'Segoe UI',system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.65;color:#23211d}
h1,h2,h3{line-height:1.25}pre{background:#f3f1ec;padding:12px;border-radius:8px;overflow:auto}code{font-family:Consolas,monospace}
blockquote{border-left:3px solid #ddd;margin:0;padding-left:14px;color:#555}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}
img{max-width:100%}[data-type=callout]{background:#eef4ff;border:1px solid #cfe0ff;border-radius:8px;padding:10px 14px}
ul[data-type=taskList]{list-style:none;padding-left:4px}li[data-checked=true]{text-decoration:line-through;color:#999}
li[data-type=taskItem]::before{content:'☐ '}li[data-checked=true]::before{content:'☑ '}
@media print{body{margin:0}}
</style></head><body><h1>${safeTitle}</h1>
${bodyHtml}
</body></html>`;
}

/** Prints HTML through the system print dialog (Save as PDF on Windows). */
export function printHtml(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 300);
}
