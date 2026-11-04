import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';

export interface HeadingEntry { position: number; level: number; text: string }

export function editorHeadings(editor: Editor): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'heading' && node.textContent.trim()) headings.push({ position, level: Number(node.attrs.level), text: node.textContent });
  });
  return headings;
}

export function HeadingList({ editor }: { editor: Editor }) {
  const t = useT();
  const [headings, setHeadings] = useState(() => editorHeadings(editor));
  useEffect(() => {
    const update = () => setHeadings(editorHeadings(editor));
    editor.on('update', update);
    update();
    return () => { editor.off('update', update); };
  }, [editor]);
  return <nav aria-label={t('toc.title')} className="space-y-1 text-sm">
    {!headings.length && <p className="text-xs text-muted">{t('toc.empty')}</p>}
    {headings.map((heading) => <button type="button" key={heading.position} className="block w-full truncate rounded px-2 py-1 text-left text-muted hover:bg-hover hover:text-fg" style={{ paddingLeft: `${(heading.level - 1) * 12 + 8}px` }} onClick={() => editor.chain().focus().setTextSelection(heading.position + 1).scrollIntoView().run()}>{heading.text}</button>)}
  </nav>;
}

function ContentsView({ editor }: NodeViewProps) {
  const t = useT();
  return <NodeViewWrapper data-type="table-of-contents" className="my-4 rounded-lg border border-line bg-inset p-3" contentEditable={false}>
    <div className="mb-2 text-xs font-semibold uppercase text-muted">{t('toc.title')}</div>
    <HeadingList editor={editor} />
  </NodeViewWrapper>;
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  parseHTML() { return [{ tag: 'div[data-type="table-of-contents"]' }]; },
  renderHTML() { return ['div', { 'data-type': 'table-of-contents' }, 'Table of contents']; },
  addNodeView() { return ReactNodeViewRenderer(ContentsView); },
});
