import { generateHTML, generateJSON } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Mathematics } from '@tiptap/extension-mathematics';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import { Bookmark, Callout, FileAttachment, PageMention } from './nodes';
import type { DocNode } from '../core/doc';

/** Schema-only extension set for converting documents outside a live editor. */
const EXTENSIONS = [
  StarterKit.configure({ link: { openOnClick: false, protocols: ['noesis'] } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit,
  Details,
  DetailsSummary,
  DetailsContent,
  Mathematics,
  Image,
  Highlight,
  Callout,
  PageMention,
  Bookmark,
  FileAttachment,
];

export function docToHtml(doc: DocNode): string {
  return generateHTML(doc as never, EXTENSIONS);
}

export function htmlToDoc(html: string): DocNode {
  return generateJSON(html, EXTENSIONS) as DocNode;
}
