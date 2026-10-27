import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor as TEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import DragHandle from '@tiptap/extension-drag-handle-react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { TableKit } from '@tiptap/extension-table';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Mathematics } from '@tiptap/extension-mathematics';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  Bold,
  CheckSquare,
  ChevronRight,
  Code,
  Code2,
  Copy,
  FileText,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Paperclip,
  Pilcrow,
  Quote,
  Sigma,
  Sparkles,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Globe,
  Lightbulb,
  ListTodo,
  FilePlus,
} from 'lucide-react';
import { Bookmark, Callout, createSuggestionExtension, FileAttachment, imageNodeView, PageMention, type SuggestItem } from './nodes';
import { cx, MenuList, Popover, promptDialog, type MenuItem } from '../components/ui';
import { useT, t as tr } from '../i18n';
import { repos, useApp, wsId } from '../app/state';
import { blobStore, openExternal, pickFiles } from '../lib/platform';
import { sha256Hex } from '../lib/util';
import { openAiPreview } from '../features/ai/AiPreview';
import { markdownToHtml } from './markdown';
import type { AssistantAction } from '../ai/assistant';
import { reportError } from '../app/services';
import type { DocNode } from '../core/doc';

const lowlight = createLowlight(common);

const ImageWithAttachments = Image.extend({ addNodeView: imageNodeView, draggable: true }).configure({ allowBase64: false });

async function storeFile(file: { name: string; bytes: Uint8Array; mime: string }) {
  const key = await blobStore.put(file.name, file.bytes);
  return repos().attachments.create({
    workspace_id: wsId(),
    file_name: file.name,
    mime: file.mime || 'application/octet-stream',
    size: file.bytes.byteLength,
    storage_key: key,
    sha256: await sha256Hex(file.bytes),
  });
}

async function insertImage(editor: TEditor) {
  const [file] = await pickFiles('image/*', false);
  if (!file) return;
  const att = await storeFile(file);
  editor.chain().focus().setImage({ src: `attachment:${att.id}`, alt: file.name }).run();
}

async function insertFile(editor: TEditor) {
  const files = await pickFiles('*', true);
  for (const f of files) {
    if (f.bytes.byteLength > 200 * 1024 * 1024) {
      useApp.getState().toast(`${f.name}: file exceeds 200 MB`, 'error');
      continue;
    }
    const att = await storeFile(f);
    editor.chain().focus().setFileAttachment({ attachmentId: att.id, name: f.name, size: f.bytes.byteLength, mime: f.mime }).run();
  }
}

function slashItems(pageId: string): (q: string) => SuggestItem[] {
  return (query) => {
    const i = (id: string, title: string, icon: React.ReactNode, keywords: string, run: SuggestItem['run']): SuggestItem => ({ id, title, icon, keywords, run });
    const all: SuggestItem[] = [
      i('p', tr('editor.slash.text'), <Pilcrow className="size-4" />, 'text paragraph metin', (e, r) => e.chain().focus().deleteRange(r).setParagraph().run()),
      i('h1', tr('editor.slash.h1'), <Heading1 className="size-4" />, 'h1 heading title başlık', (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run()),
      i('h2', tr('editor.slash.h2'), <Heading2 className="size-4" />, 'h2 heading başlık', (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run()),
      i('h3', tr('editor.slash.h3'), <Heading3 className="size-4" />, 'h3 heading başlık', (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run()),
      i('h4', tr('editor.slash.h4'), <Heading4 className="size-4" />, 'h4 heading', (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 4 }).run()),
      i('h5', tr('editor.slash.h5'), <Heading4 className="size-4" />, 'h5 heading', (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 5 }).run()),
      i('h6', tr('editor.slash.h6'), <Heading4 className="size-4" />, 'h6 heading', (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 6 }).run()),
      i('ul', tr('editor.slash.bullet'), <List className="size-4" />, 'bullet list unordered madde', (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run()),
      i('ol', tr('editor.slash.numbered'), <ListOrdered className="size-4" />, 'numbered ordered list numaralı', (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run()),
      i('todo', tr('editor.slash.todo'), <ListTodo className="size-4" />, 'todo task checklist checkbox yapılacak', (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run()),
      i('quote', tr('editor.slash.quote'), <Quote className="size-4" />, 'quote blockquote alıntı', (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run()),
      i('callout', tr('editor.slash.callout'), <Lightbulb className="size-4" />, 'callout note info bilgi', (e, r) => e.chain().focus().deleteRange(r).setCallout('info').run()),
      i('code', tr('editor.slash.code'), <Code2 className="size-4" />, 'code block snippet kod', (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run()),
      i('hr', tr('editor.slash.divider'), <Minus className="size-4" />, 'divider hr line ayırıcı', (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run()),
      i('table', tr('editor.slash.table'), <TableIcon className="size-4" />, 'table grid tablo', (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
      i('toggle', tr('editor.slash.toggle'), <ChevronRight className="size-4" />, 'toggle details collapsible açılır', (e, r) => e.chain().focus().deleteRange(r).setDetails().run()),
      i('image', tr('editor.slash.image'), <ImageIcon className="size-4" />, 'image picture photo görsel resim', (e, r) => {
        e.chain().focus().deleteRange(r).run();
        void insertImage(e).catch(reportError);
      }),
      i('file', tr('editor.slash.file'), <Paperclip className="size-4" />, 'file attachment upload dosya ek', (e, r) => {
        e.chain().focus().deleteRange(r).run();
        void insertFile(e).catch(reportError);
      }),
      i('bookmark', tr('editor.slash.bookmark'), <Globe className="size-4" />, 'bookmark link url web yer imi', (e, r) => {
        e.chain().focus().deleteRange(r).run();
        void promptDialog(tr('editor.bookmark.prompt'), 'https://').then((url) => {
          if (url && /^https?:\/\/\S+$/.test(url.trim())) e.chain().focus().setBookmark({ url: url.trim() }).run();
        });
      }),
      i('math', tr('editor.slash.math'), <Sigma className="size-4" />, 'math latex equation formula matematik', (e, r) => {
        e.chain().focus().deleteRange(r).run();
        void promptDialog(tr('editor.math.prompt'), 'E = mc^2').then((latex) => latex && e.chain().focus().insertBlockMath({ latex }).run());
      }),
      i('imath', tr('editor.slash.inlineMath'), <Sigma className="size-4" />, 'inline math latex', (e, r) => {
        e.chain().focus().deleteRange(r).run();
        void promptDialog(tr('editor.math.prompt'), 'x^2').then((latex) => latex && e.chain().focus().insertInlineMath({ latex }).run());
      }),
      i('mention', tr('editor.slash.mention'), <FileText className="size-4" />, 'link page mention bağlantı sayfa', (e, r) => e.chain().focus().deleteRange(r).insertContent('@').run()),
      i('subpage', tr('editor.slash.subpage'), <FilePlus className="size-4" />, 'subpage child page alt sayfa', (e, r) => {
        e.chain().focus().deleteRange(r).run();
        void repos()
          .pages.create({ workspaceId: wsId(), parentId: pageId, title: '' })
          .then((p) => {
            e.chain().focus().insertContent({ type: 'pageMention', attrs: { id: p.id, label: tr('common.untitled') } }).run();
            useApp.getState().bump();
          });
      }),
      i('ai', tr('editor.slash.ai'), <Sparkles className="size-4" />, 'ai assistant continue write yapay zeka', (e, r) => {
        e.chain().focus().deleteRange(r).run();
        const before = e.state.doc.textBetween(Math.max(0, e.state.selection.from - 3000), e.state.selection.from, '\n');
        openAiPreview({
          action: 'continue',
          label: tr('ai.continue'),
          original: before || e.getText().slice(-3000),
          onInsert: (md) => e.chain().focus().insertContent(markdownToHtml(md)).run(),
        });
      }),
    ];
    const q = query.toLocaleLowerCase();
    return q ? all.filter((it) => it.title.toLocaleLowerCase().includes(q) || it.keywords?.includes(q)) : all;
  };
}

async function mentionItems(query: string, pageId: string): Promise<SuggestItem[]> {
  const pages = await repos().pages.listTree(wsId());
  const q = query.toLocaleLowerCase();
  const list = pages.filter((p) => p.id !== pageId && (p.title || '').toLocaleLowerCase().includes(q)).slice(0, 8);
  const items: SuggestItem[] = list.map((p) => ({
    id: p.id,
    title: p.title || tr('common.untitled'),
    icon: <span>{p.icon ?? <FileText className="size-4" />}</span>,
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent([{ type: 'pageMention', attrs: { id: p.id, label: p.title || tr('common.untitled') } }, { type: 'text', text: ' ' }])
        .run(),
  }));
  if (query.trim()) {
    items.push({
      id: '__new',
      title: `+ ${query.trim()}`,
      subtitle: tr('nav.newPage'),
      icon: <FilePlus className="size-4" />,
      run: async (e, r) => {
        const p = await repos().pages.create({ workspaceId: wsId(), parentId: pageId, title: query.trim() });
        e.chain().focus().deleteRange(r).insertContent([{ type: 'pageMention', attrs: { id: p.id, label: p.title } }, { type: 'text', text: ' ' }]).run();
        useApp.getState().bump();
      },
    });
  }
  return items;
}

export interface EditorProps {
  pageId: string;
  initialContent: DocNode | null;
  onChange: (doc: DocNode, editor: TEditor) => void;
  onReady?: (editor: TEditor) => void;
  editable?: boolean;
}

export function NoteEditor({ pageId, initialContent, onChange, onReady, editable = true }: EditorProps) {
  const t = useT();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: { openOnClick: false, autolink: true, protocols: ['noesis'], HTMLAttributes: { rel: 'noopener noreferrer' } },
        dropcursor: { color: 'var(--accent)', width: 2 },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'heading' ? tr('editor.slash.h1') : tr('editor.placeholder')),
        includeChildren: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      Details.configure({ persist: true, HTMLAttributes: { class: 'details' } }),
      DetailsSummary,
      DetailsContent,
      Mathematics.configure({
        katexOptions: { throwOnError: false },
        inlineOptions: {
          onClick: (node: PMNode, pos: number) => {
            void promptDialog(tr('editor.math.prompt'), String(node.attrs.latex)).then((latex) => {
              if (latex !== null) editorRef.current?.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run();
            });
          },
        },
        blockOptions: {
          onClick: (node: PMNode, pos: number) => {
            void promptDialog(tr('editor.math.prompt'), String(node.attrs.latex)).then((latex) => {
              if (latex !== null) editorRef.current?.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run();
            });
          },
        },
      }),
      ImageWithAttachments,
      Highlight,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
      Callout,
      PageMention,
      Bookmark,
      FileAttachment,
      createSuggestionExtension('slashCommand', '/', slashItems(pageId), tr('editor.slash.empty')),
      createSuggestionExtension('pageMentionSuggest', '@', (q) => mentionItems(q, pageId), tr('editor.slash.empty')),
      createSuggestionExtension('wikiLinkSuggest', '[[', (q) => mentionItems(q, pageId), tr('editor.slash.empty')),
    ],
    [pageId],
  );
  const editorRef = useRef<TEditor | null>(null);

  const editor = useEditor(
    {
      extensions,
      content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      editable,
      editorProps: {
        attributes: { class: 'noesis-editor', spellcheck: 'true', 'aria-label': 'Page content' },
        handleClickOn: (_view, _pos, _node, _nodePos, event) => {
          const a = (event.target as HTMLElement).closest('a');
          if (a && (event.ctrlKey || event.metaKey || !editable)) {
            const href = a.getAttribute('href') ?? '';
            if (href.startsWith('noesis://page/')) useApp.getState().navigate({ name: 'page', id: href.slice('noesis://page/'.length) });
            else if (/^https?:/.test(href)) void openExternal(href);
            return true;
          }
          return false;
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (!files.length) return false;
          event.preventDefault();
          void (async () => {
            for (const f of files) {
              const att = await storeFile({ name: f.name || 'pasted.png', bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type });
              editorRef.current?.chain().focus().setImage({ src: `attachment:${att.id}`, alt: f.name }).run();
            }
          })().catch(reportError);
          return true;
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (moved) return false;
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (!files.length) return false;
          event.preventDefault();
          void (async () => {
            for (const f of files) {
              const bytes = new Uint8Array(await f.arrayBuffer());
              const att = await storeFile({ name: f.name, bytes, mime: f.type });
              if (f.type.startsWith('image/')) editorRef.current?.chain().focus().setImage({ src: `attachment:${att.id}`, alt: f.name }).run();
              else editorRef.current?.chain().focus().setFileAttachment({ attachmentId: att.id, name: f.name, size: bytes.byteLength, mime: f.type }).run();
            }
          })().catch(reportError);
          return true;
        },
      },
      onUpdate: ({ editor }) => onChangeRef.current(editor.getJSON() as DocNode, editor),
      immediatelyRender: true,
    },
    [pageId],
  );

  useEffect(() => {
    editorRef.current = editor;
    if (editor) onReady?.(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;
  return (
    <div className="relative">
      {editable && <BlockHandle editor={editor} pageId={pageId} />}
      {editable && <FormatBubble editor={editor} />}
      <EditorContent editor={editor} />
      <span className="sr-only">{t('editor.placeholder')}</span>
    </div>
  );
}

const AI_ACTIONS: AssistantAction[] = ['rewrite', 'grammar', 'summarize', 'shorten', 'expand', 'explain', 'translate', 'outline', 'action_items', 'organize'];

function selectionMarkdownTarget(editor: TEditor) {
  const { from, to } = editor.state.selection;
  return { from, to, text: editor.state.doc.textBetween(from, to, '\n\n') };
}

export function runAiOnSelection(editor: TEditor, action: AssistantAction) {
  const { from, to, text } = selectionMarkdownTarget(editor);
  if (!text.trim()) return;
  openAiPreview({
    action,
    label: tr(`ai.${action}` as never),
    original: text,
    onReplace: (md) => editor.chain().focus().insertContentAt({ from, to }, markdownToHtml(md)).run(),
    onInsert: (md) => editor.chain().focus().insertContentAt(to, markdownToHtml(md)).run(),
  });
}

function FormatBubble({ editor }: { editor: TEditor }) {
  const t = useT();
  const [aiOpen, setAiOpen] = useState(false);
  const aiBtn = useRef<HTMLButtonElement>(null);
  const btn = (active: boolean, label: string, icon: React.ReactNode, run: () => void) => (
    <button
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cx('flex size-7 items-center justify-center rounded-md hover:bg-hover', active ? 'text-accent' : 'text-muted')}
    >
      {icon}
    </button>
  );
  const items: MenuItem[] = AI_ACTIONS.map((a) => ({ label: t(`ai.${a}` as never), onSelect: () => runAiOnSelection(editor, a) }));
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) => !state.selection.empty && e.isEditable && !e.isActive('image') && !e.isActive('codeBlock')}
      options={{ placement: 'top' }}
    >
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-elevated p-1 shadow-pop">
        <button
          ref={aiBtn}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAiOpen((o) => !o)}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-accent hover:bg-accent-soft"
        >
          <Sparkles className="size-3.5" /> {t('ai.actions')}
        </button>
        <div className="mx-0.5 h-5 w-px bg-line" />
        {btn(editor.isActive('bold'), `${t('shortcut.bold')} (Ctrl+B)`, <Bold className="size-4" />, () => editor.chain().focus().toggleBold().run())}
        {btn(editor.isActive('italic'), `${t('shortcut.italic')} (Ctrl+I)`, <Italic className="size-4" />, () => editor.chain().focus().toggleItalic().run())}
        {btn(editor.isActive('underline'), `${t('shortcut.underline')} (Ctrl+U)`, <UnderlineIcon className="size-4" />, () => editor.chain().focus().toggleUnderline().run())}
        {btn(editor.isActive('strike'), 'Strikethrough', <Strikethrough className="size-4" />, () => editor.chain().focus().toggleStrike().run())}
        {btn(editor.isActive('code'), `${t('shortcut.code')} (Ctrl+E)`, <Code className="size-4" />, () => editor.chain().focus().toggleCode().run())}
        {btn(editor.isActive('highlight'), 'Highlight', <Highlighter className="size-4" />, () => editor.chain().focus().toggleHighlight().run())}
        {btn(editor.isActive('link'), `${t('shortcut.link')} (Ctrl+K)`, <Link2 className="size-4" />, () => {
          const prev = String(editor.getAttributes('link').href ?? '');
          void promptDialog(t('editor.link.prompt'), prev || 'https://').then((url) => {
            if (url === null) return;
            if (!url.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
            else if (/^(https?:|mailto:|noesis:)/i.test(url.trim())) editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
          });
        })}
        <Popover anchor={aiBtn.current} open={aiOpen} onClose={() => setAiOpen(false)}>
          <MenuList items={items} onClose={() => setAiOpen(false)} />
        </Popover>
      </div>
    </BubbleMenu>
  );
}

function BlockHandle({ editor, pageId }: { editor: TEditor; pageId: string }) {
  const t = useT();
  const [current, setCurrent] = useState<{ node: PMNode; pos: number } | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const turnInto = (fn: (c: ReturnType<TEditor['chain']>) => ReturnType<TEditor['chain']>) => () => {
    if (!current) return;
    fn(editor.chain().focus().setTextSelection(current.pos + 1)).run();
  };
  const items = (): MenuItem[] => {
    if (!current) return [];
    const { node, pos } = current;
    return [
      { label: t('editor.block.askAi'), icon: <Sparkles className="size-3.5" />, onSelect: () => {
        editor.chain().setTextSelection({ from: pos, to: pos + node.nodeSize }).run();
        runAiOnSelection(editor, 'explain');
      } },
      {
        label: t('editor.block.toTask'),
        icon: <CheckSquare className="size-3.5" />,
        disabled: !node.textContent.trim(),
        onSelect: async () => {
          try {
            const title = node.textContent.trim().slice(0, 300);
            await repos().tasks.create({ workspaceId: wsId(), title, sourcePageId: pageId, projectPageId: pageId });
            useApp.getState().toast(t('editor.taskCreated', { title }), 'success', { label: t('nav.tasks'), run: () => useApp.getState().navigate({ name: 'tasks' }) });
            useApp.getState().bump();
          } catch (e) {
            reportError(e);
          }
        },
      },
      { separator: true, label: '' },
      { label: t('editor.slash.text'), icon: <Pilcrow className="size-3.5" />, onSelect: turnInto((c) => c.setParagraph()) },
      { label: t('editor.slash.h1'), icon: <Heading1 className="size-3.5" />, onSelect: turnInto((c) => c.setHeading({ level: 1 })) },
      { label: t('editor.slash.h2'), icon: <Heading2 className="size-3.5" />, onSelect: turnInto((c) => c.setHeading({ level: 2 })) },
      { label: t('editor.slash.h3'), icon: <Heading3 className="size-3.5" />, onSelect: turnInto((c) => c.setHeading({ level: 3 })) },
      { label: t('editor.slash.bullet'), icon: <List className="size-3.5" />, onSelect: turnInto((c) => c.toggleBulletList()) },
      { label: t('editor.slash.todo'), icon: <ListTodo className="size-3.5" />, onSelect: turnInto((c) => c.toggleTaskList()) },
      { label: t('editor.slash.quote'), icon: <Quote className="size-3.5" />, onSelect: turnInto((c) => c.toggleBlockquote()) },
      { label: t('editor.slash.code'), icon: <Code2 className="size-3.5" />, onSelect: turnInto((c) => c.toggleCodeBlock()) },
      { separator: true, label: '' },
      {
        label: t('editor.block.copyText'),
        icon: <Copy className="size-3.5" />,
        onSelect: () => void navigator.clipboard.writeText(node.textContent),
      },
      {
        label: t('editor.block.duplicate'),
        icon: <Copy className="size-3.5" />,
        onSelect: () => editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run(),
      },
      {
        label: t('editor.block.delete'),
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onSelect: () => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run(),
      },
    ];
  };
  return (
    <>
      <DragHandle editor={editor} onNodeChange={({ node, pos }) => setCurrent(node ? { node, pos } : null)}>
        <button
          className="drag-handle -ml-1"
          aria-label="Drag to move, click for block menu"
          title="Drag to move · Click for menu"
          onClick={(e) => setMenuAnchor(e.currentTarget)}
        >
          <GripVertical className="size-4" />
        </button>
      </DragHandle>
      <Popover anchor={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuList items={items()} onClose={() => setMenuAnchor(null)} />
      </Popover>
    </>
  );
}
