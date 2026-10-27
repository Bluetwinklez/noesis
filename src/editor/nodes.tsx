import { mergeAttributes, Node, Extension, type Editor, type Range } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, type NodeViewProps } from '@tiptap/react';
import Suggestion, { type SuggestionOptions, type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { forwardRef, useEffect, useImperativeHandle, useState, type ReactNode } from 'react';
import { Download, ExternalLink, FileText, Globe, Paperclip } from 'lucide-react';
import { PAGE_LINK_PREFIX } from '../core/doc';
import { openExternal, blobStore } from '../lib/platform';
import { formatBytes, safeFileName } from '../lib/util';
import { saveFile } from '../lib/platform';
import { repos, useApp } from '../app/state';
import { cx } from '../components/ui';

// ---------------- Callout ----------------
const CALLOUT_TONES = ['info', 'success', 'warning', 'danger', 'note'] as const;
const TONE_STYLE: Record<string, string> = {
  info: 'bg-blue-500/8 border-blue-500/25',
  success: 'bg-emerald-500/8 border-emerald-500/25',
  warning: 'bg-amber-500/10 border-amber-500/30',
  danger: 'bg-red-500/8 border-red-500/25',
  note: 'bg-hover border-line',
};
const TONE_EMOJI: Record<string, string> = { info: '💡', success: '✅', warning: '⚠️', danger: '🚫', note: '📝' };

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const tone = String(node.attrs.tone ?? 'info');
  return (
    <NodeViewWrapper className={cx('my-2 flex gap-3 rounded-lg border px-4 py-3', TONE_STYLE[tone])} data-type="callout">
      <button
        contentEditable={false}
        className="h-7 shrink-0 select-none text-[18px] leading-7"
        title="Change style"
        disabled={!editor.isEditable}
        onClick={() => {
          const next = CALLOUT_TONES[(CALLOUT_TONES.indexOf(tone as never) + 1) % CALLOUT_TONES.length];
          updateAttributes({ tone: next });
        }}
      >
        {TONE_EMOJI[tone]}
      </button>
      <NodeViewContent className="min-w-0 flex-1 [&>*+*]:mt-1" />
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: { setCallout: (tone?: string) => ReturnType };
    bookmark: { setBookmark: (attrs: { url: string; title?: string }) => ReturnType };
    fileAttachment: { setFileAttachment: (attrs: { attachmentId: string; name: string; size: number; mime: string }) => ReturnType };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { tone: { default: 'info', parseHTML: (el) => el.getAttribute('data-tone') ?? 'info', renderHTML: (a) => ({ 'data-tone': a.tone }) } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }, { tag: 'aside.callout' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'callout' }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
  addCommands() {
    return {
      setCallout:
        (tone = 'info') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { tone }),
    };
  },
});

// ---------------- Page mention ----------------
function MentionView({ node }: NodeViewProps) {
  const id = String(node.attrs.id);
  const [title, setTitle] = useState<string>(String(node.attrs.label ?? ''));
  const [missing, setMissing] = useState(false);
  const version = useApp((s) => s.version);
  useEffect(() => {
    void repos()
      .pages.get(id)
      .then((p) => {
        setMissing(!p || !!p.deleted_at);
        if (p) setTitle((p.icon ? p.icon + ' ' : '') + (p.title || 'Untitled'));
      });
  }, [id, version]);
  return (
    <NodeViewWrapper
      as="span"
      className={cx('mx-0.5 inline-flex cursor-pointer items-center gap-1 rounded px-1 font-medium underline decoration-line-strong underline-offset-2 hover:bg-hover', missing && 'text-faint line-through')}
      onClick={() => !missing && useApp.getState().navigate({ name: 'page', id })}
      data-type="page-mention"
    >
      <FileText className="inline size-3.5 text-muted" />
      {title}
    </NodeViewWrapper>
  );
}

export const PageMention = Node.create({
  name: 'pageMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-id'), renderHTML: (a) => ({ 'data-id': a.id }) },
      label: { default: '', parseHTML: (el) => el.textContent, renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-type="page-mention"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-type': 'page-mention', href: PAGE_LINK_PREFIX + node.attrs.id }), String(node.attrs.label || 'page')];
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(MentionView);
  },
});

// ---------------- Bookmark ----------------
function BookmarkView({ node, selected }: NodeViewProps) {
  const url = String(node.attrs.url);
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep raw */
  }
  return (
    <NodeViewWrapper data-type="bookmark" className="my-2">
      <div
        contentEditable={false}
        className={cx('flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-elevated p-3 hover:bg-hover', selected && 'ring-2 ring-accent')}
        onClick={() => void openExternal(url)}
      >
        <div className="flex size-9 items-center justify-center rounded-md bg-inset text-muted">
          <Globe className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{String(node.attrs.title || host)}</div>
          <div className="truncate text-xs text-faint">{url}</div>
        </div>
        <ExternalLink className="size-4 text-faint" />
      </div>
    </NodeViewWrapper>
  );
}

export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: '' }, title: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="bookmark"]', getAttrs: (el) => ({ url: (el as HTMLElement).getAttribute('data-url'), title: (el as HTMLElement).textContent }) }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-type': 'bookmark', 'data-url': node.attrs.url }, ['a', { href: node.attrs.url }, node.attrs.title || node.attrs.url]];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },
  addCommands() {
    return {
      setBookmark:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

// ---------------- File attachment ----------------
function FileView({ node, selected }: NodeViewProps) {
  const { attachmentId, name, size } = node.attrs as { attachmentId: string; name: string; size: number };
  const download = async () => {
    const att = await repos().attachments.get(attachmentId);
    if (!att) return useApp.getState().toast('Attachment is missing', 'error');
    await saveFile(att.file_name, await blobStore.get(att.storage_key));
  };
  return (
    <NodeViewWrapper data-type="file-attachment" className="my-2">
      <div contentEditable={false} className={cx('flex items-center gap-3 rounded-lg border border-line bg-elevated p-2.5', selected && 'ring-2 ring-accent')}>
        <Paperclip className="size-4 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="text-xs text-faint">{formatBytes(size)}</div>
        </div>
        <button className="rounded-md p-1.5 text-muted hover:bg-hover" onClick={() => void download()} aria-label="Download">
          <Download className="size-4" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { attachmentId: { default: null }, name: { default: 'file' }, size: { default: 0 }, mime: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="file-attachment"]',
        getAttrs: (el) => ({ attachmentId: (el as HTMLElement).getAttribute('data-id'), name: (el as HTMLElement).textContent }),
      },
    ];
  },
  renderHTML({ node }) {
    return ['div', { 'data-type': 'file-attachment', 'data-id': node.attrs.attachmentId }, `📎 ${safeFileName(String(node.attrs.name))}`];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileView);
  },
  addCommands() {
    return {
      setFileAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

// ---------------- Images stored as attachments ----------------
/** Resolves `attachment:<id>` image sources to blob URLs. */
const urlCache = new Map<string, string>();
export async function resolveAttachmentUrl(src: string): Promise<string> {
  if (!src.startsWith('attachment:')) return src;
  const id = src.slice('attachment:'.length);
  if (urlCache.has(id)) return urlCache.get(id)!;
  const att = await repos().attachments.get(id);
  if (!att) return '';
  const bytes = await blobStore.get(att.storage_key);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: att.mime }));
  urlCache.set(id, url);
  return url;
}

function ImageView({ node, selected }: NodeViewProps) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    void resolveAttachmentUrl(String(node.attrs.src)).then(setSrc);
  }, [node.attrs.src]);
  return (
    <NodeViewWrapper data-type="image" className="my-2">
      {src ? (
        <img src={src} alt={String(node.attrs.alt ?? '')} className={cx('max-w-full rounded-lg', selected && 'outline-2 outline-accent')} draggable={false} />
      ) : (
        <div className="skeleton h-40 w-full" />
      )}
    </NodeViewWrapper>
  );
}
export const imageNodeView = () => ReactNodeViewRenderer(ImageView);

// ---------------- Generic suggestion list (slash + mentions) ----------------
export interface SuggestItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  keywords?: string;
  run: (editor: Editor, range: Range) => void;
}

export interface SuggestListHandle {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

export const SuggestList = forwardRef<SuggestListHandle, SuggestionProps<SuggestItem> & { emptyLabel: string }>(function SuggestList(props, ref) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    setActive(0);
  }, [props.items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setActive((a) => (a + 1) % Math.max(1, props.items.length));
        return true;
      }
      if (event.key === 'ArrowUp') {
        setActive((a) => (a - 1 + props.items.length) % Math.max(1, props.items.length));
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const it = props.items[active];
        if (it) props.command(it);
        return true;
      }
      return false;
    },
  }));
  useEffect(() => {
    document.querySelector(`[data-suggest-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div className="max-h-[320px] w-[290px] overflow-y-auto rounded-lg border border-line bg-elevated p-1 shadow-pop animate-in" role="listbox">
      {props.items.length === 0 && <div className="px-3 py-2 text-sm text-faint">{props.emptyLabel}</div>}
      {props.items.map((it, i) => (
        <button
          key={it.id}
          data-suggest-idx={i}
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            props.command(it);
          }}
          className={cx('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left', i === active && 'bg-hover')}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-bg text-muted">{it.icon}</span>
          <span className="min-w-0">
            <span className="block truncate text-[13.5px]">{it.title}</span>
            {it.subtitle && <span className="block truncate text-xs text-faint">{it.subtitle}</span>}
          </span>
        </button>
      ))}
    </div>
  );
});

/** Positions a React suggestion popup next to the caret. */
export function suggestionRenderer(emptyLabel: string): SuggestionOptions<SuggestItem>['render'] {
  return () => {
    let component: ReactRenderer<SuggestListHandle, SuggestionProps<SuggestItem> & { emptyLabel: string }> | null = null;
    let el: HTMLDivElement | null = null;
    const place = (props: SuggestionProps<SuggestItem>) => {
      const rect = props.clientRect?.();
      if (!rect || !el) return;
      const h = el.offsetHeight || 320;
      const top = rect.bottom + 6 + h > window.innerHeight ? rect.top - h - 6 : rect.bottom + 6;
      el.style.top = `${Math.max(8, top)}px`;
      el.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
    };
    return {
      onStart: (props) => {
        component = new ReactRenderer(SuggestList, { props: { ...props, emptyLabel }, editor: props.editor });
        el = document.createElement('div');
        el.style.position = 'fixed';
        el.style.zIndex = '60';
        el.appendChild(component.element);
        document.body.appendChild(el);
        requestAnimationFrame(() => place(props));
      },
      onUpdate: (props) => {
        component?.updateProps({ ...props, emptyLabel });
        place(props);
      },
      onKeyDown: (props) => {
        if (props.event.key === 'Escape') {
          el?.remove();
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        el?.remove();
        component?.destroy();
        el = null;
        component = null;
      },
    };
  };
}

export function createSuggestionExtension(name: string, char: string, items: (query: string) => SuggestItem[] | Promise<SuggestItem[]>, emptyLabel: string) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion<SuggestItem>({
          editor: this.editor,
          pluginKey: new PluginKey(name),
          char,
          allowSpaces: char !== '/',
          startOfLine: false,
          items: ({ query }) => items(query),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: suggestionRenderer(emptyLabel),
        }),
      ];
    },
  });
}
