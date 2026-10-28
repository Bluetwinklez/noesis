import { useMemo } from 'react';
import { marked } from 'marked';
import { sanitizeHtml } from '../../editor/markdown';
import { uncitedSentenceRanges } from '../../ai/evidence';
import type { Citation } from '../../core/types';
import { useApp } from '../../app/state';
import { useT } from '../../i18n';

/** Work on sanitized HTML in a detached document, before React owns the result. */
function answerHtml(text: string, citations: Citation[], lang: string, warning: string, sourceLabel: (c: Citation) => string) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const encoded = text.replace(/\[(\d+)\]/g, (m, n: string) => byN.has(Number(n)) ? `@@NOESIS_CITE${n}@@` : m);
  const doc = new DOMParser().parseFromString(sanitizeHtml(marked.parse(encoded, { async: false, gfm: true }) as string), 'text/html');
  if (citations.length) {
    for (const block of doc.body.querySelectorAll('p,li,td,th')) {
      if (block.querySelector('p,li,td,th')) continue;
      const ranges = uncitedSentenceRanges(block.textContent ?? '', new Set(byN.keys()), lang);
      const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      let offset = 0;
      for (const node of nodes) {
        const value = node.data;
        const base = offset;
        offset += value.length;
        if (node.parentElement?.closest('code,pre,a')) continue;
        const matches = ranges.map((r) => ({ start: Math.max(0, r.start - base), end: Math.min(value.length, r.end - base) })).filter((r) => r.end > r.start);
        if (!matches.length) continue;
        const fragment = doc.createDocumentFragment();
        let cursor = 0;
        for (const range of matches) {
          fragment.appendChild(doc.createTextNode(value.slice(cursor, range.start)));
          const span = doc.createElement('span');
          span.dataset.evidence = 'uncited';
          span.title = warning;
          span.className = 'underline decoration-dotted decoration-warning/60 underline-offset-4';
          span.textContent = value.slice(range.start, range.end);
          fragment.appendChild(span);
          cursor = range.end;
        }
        fragment.appendChild(doc.createTextNode(value.slice(cursor)));
        node.replaceWith(fragment);
      }
    }
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const markers: Text[] = [];
  while (walker.nextNode()) if (/@@NOESIS_CITE\d+@@/.test(walker.currentNode.nodeValue ?? '')) markers.push(walker.currentNode as Text);
  for (const node of markers) {
    if (node.parentElement?.closest('code,pre,a')) { node.data = node.data.replace(/@@NOESIS_CITE(\d+)@@/g, '[$1]'); continue; }
    const fragment = doc.createDocumentFragment();
    for (const piece of node.data.split(/(@@NOESIS_CITE\d+@@)/)) {
      const number = piece.match(/^@@NOESIS_CITE(\d+)@@$/)?.[1];
      const citation = number ? byN.get(Number(number)) : undefined;
      if (!citation) { fragment.appendChild(doc.createTextNode(piece)); continue; }
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.citation = String(citation.n);
      button.setAttribute('aria-label', sourceLabel(citation));
      button.title = `${sourceLabel(citation)}\n\n${citation.excerpt}`;
      button.className = 'mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-soft px-1 align-text-top text-[11px] font-semibold text-accent hover:bg-accent hover:text-white';
      button.textContent = String(citation.n);
      fragment.appendChild(button);
    }
    node.replaceWith(fragment);
  }
  return doc.body.innerHTML;
}

export function EvidenceAnswer({ text, citations, onOpen }: { text: string; citations: Citation[]; onOpen: (c: Citation) => void }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const html = useMemo(() => answerHtml(text, citations, lang, t('nb.uncitedSentence'), (c) => c.pageNumber ? t('nb.citationPage', { title: c.sourceTitle, n: c.pageNumber }) : c.sourceTitle), [text, citations, lang]);
  return <div className="prose-noesis" dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-citation]');
    if (!button || !e.currentTarget.contains(button)) return;
    const citation = citations.find((c) => c.n === Number(button.dataset.citation));
    if (citation) onOpen(citation);
  }} />;
}
