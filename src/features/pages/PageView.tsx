import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor as TEditor } from '@tiptap/react';
import {
  Archive,
  Copy,
  Download,
  FileText,
  History,
  Image as ImageIcon,
  Link2,
  MoreHorizontal,
  Pin,
  Plus,
  Smile,
  Sparkles,
  Star,
  Tag as TagIcon,
  Trash2,
  Upload,
  X,
  FolderInput,
  LayoutTemplate,
  RotateCcw,
} from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT } from '../../i18n';
import { Badge, Button, confirmDialog, cx, EmptyState, IconButton, MenuButton, Modal, Popover, promptDialog, Spinner, useAsync, type MenuItem } from '../../components/ui';
import { NoteEditor, runAiOnSelection } from '../../editor/Editor';
import type { DocNode } from '../../core/doc';
import { debounce, relativeTime } from '../../lib/util';
import { useSaveStatus } from '../../components/shell/TopBar';
import { createPage, toggleFavorite, togglePinned, trashPage } from '../actions';
import { htmlToMarkdown, markdownToHtml, printHtml, standaloneHtml } from '../../editor/markdown';
import { pickFiles, saveFile } from '../../lib/platform';
import { exportDocx } from './exportDocx';
import { reportError } from '../../app/services';
import type { Page, PageMeta } from '../../core/types';
import { localHashEmbed, cosine } from '../../search/vectors';
import { openAiPreview } from '../ai/AiPreview';

const DatabaseView = lazy(() => import('../databases/DatabaseView'));

const EMOJIS = '📄 📝 📓 📚 🧠 💡 🎯 🚀 ✅ 📌 🗂️ 🧪 🔬 📊 📈 🗓️ 🧭 🌱 🔥 ⭐ 💼 🏠 ✈️ 🎓 🧩 🛠️ 🎨 🎵 ❤️ 🌍 🇹🇷 ☕'.split(' ');
const COVERS = [
  'linear-gradient(135deg,#a5b4fc,#f0abfc)',
  'linear-gradient(135deg,#fde68a,#fca5a5)',
  'linear-gradient(135deg,#99f6e4,#93c5fd)',
  'linear-gradient(135deg,#d9f99d,#6ee7b7)',
  'linear-gradient(135deg,#1e293b,#6366f1)',
  'linear-gradient(135deg,#fbcfe8,#c4b5fd,#93c5fd)',
];

export function PageView({ id }: { id: string }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const bump = useApp((s) => s.bump);
  const prefs = useApp((s) => s.prefs);
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const editorRef = useRef<TEditor | null>(null);
  const [wordCount, setWordCount] = useState(0);

  useEffect(() => {
    let alive = true;
    void repos()
      .pages.get(id)
      .then((p) => {
        if (!alive) return;
        setPage(p ?? null);
        setTitle(p?.title ?? '');
        setWordCount(p?.content_text.split(/\s+/).filter(Boolean).length ?? 0);
        if (p && !p.deleted_at) void repos().pages.touchRecent(id);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // Meta refresh (favorite, icon …) without reloading editor content.
  useEffect(() => {
    if (page === undefined) return;
    void repos()
      .pages.get(id)
      .then((p) => p && setPage((cur) => (cur ? { ...cur, ...p, content_json: cur.content_json } : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const saveContent = useMemo(
    () =>
      debounce(async (doc: DocNode) => {
        useSaveStatus.setState({ status: 'saving' });
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await repos().pages.saveContent(id, doc);
            useSaveStatus.setState({ status: 'saved' });
            return;
          } catch (e) {
            useSaveStatus.setState({ status: 'error' });
            if (attempt === 2) reportError(e);
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }, 500),
    [id],
  );

  // Flush pending edits when leaving the page or the window.
  useEffect(() => {
    const flush = () => saveContent.flush();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
      useSaveStatus.setState({ status: 'idle' });
    };
  }, [saveContent]);

  const saveTitle = useMemo(
    () =>
      debounce(async (value: string) => {
        await repos().pages.updateMeta(id, { title: value });
        bump();
      }, 400),
    [id, bump],
  );
  useEffect(() => () => saveTitle.flush(), [saveTitle]);

  const onChange = useCallback(
    (doc: DocNode, editor: TEditor) => {
      useSaveStatus.setState({ status: 'saving' });
      saveContent(doc);
      setWordCount(editor.getText().split(/\s+/).filter(Boolean).length);
    },
    [saveContent],
  );

  if (page === undefined)
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-16 pt-20">
        <div className="skeleton h-10 w-2/3" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-5/6" />
      </div>
    );
  if (page === null) return <EmptyState icon={<FileText className="size-5" />} title={t('page.notFound')} />;

  const width = prefs.fullWidth || page.kind === 'database' ? 'max-w-none px-12' : 'max-w-[760px] px-6 md:px-0';
  const initial = page.content_json ? (JSON.parse(page.content_json) as DocNode) : null;

  return (
    <div className="pb-24">
      {page.deleted_at && (
        <div className="flex items-center justify-center gap-3 bg-danger/10 py-2 text-sm text-danger">
          {t('page.trashed')}
          <Button
            size="sm"
            onClick={async () => {
              await repos().pages.restore(id);
              bump();
              setPage({ ...page, deleted_at: null });
            }}
          >
            {t('common.restore')}
          </Button>
        </div>
      )}
      <Cover page={page} />
      <div className={cx('mx-auto', width)}>
        <PageHeaderBar page={page} editorRef={editorRef} wordCount={wordCount} />
        <IconPicker page={page} />
        <textarea
          aria-label="Page title"
          value={title}
          placeholder={t('page.untitled')}
          rows={1}
          readOnly={!!page.deleted_at}
          onChange={(e) => {
            setTitle(e.target.value);
            saveTitle(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              editorRef.current?.commands.focus('start');
            }
          }}
          className="mt-1 w-full resize-none overflow-hidden bg-transparent font-display text-[38px] font-bold leading-tight tracking-tight outline-none placeholder:text-faint/70"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
        />
        <TagRow pageId={id} />
        {page.kind === 'database' ? (
          <Suspense fallback={<Spinner />}>
            <DatabaseView databaseId={id} />
          </Suspense>
        ) : (
          <div className="mt-4" style={{ fontSize: prefs.editorFontSize, fontFamily: prefs.serif ? 'var(--font-serif)' : undefined }}>
            <NoteEditor
              pageId={id}
              initialContent={initial}
              onChange={onChange}
              editable={!page.deleted_at}
              onReady={(e) => {
                editorRef.current = e;
                if (!title && !initial) setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Page title"]')?.focus(), 30);
              }}
            />
          </div>
        )}
        <SubPages pageId={id} />
        <Backlinks pageId={id} />
        <RelatedNotes page={page} />
      </div>
    </div>
  );
}

function Cover({ page }: { page: Page }) {
  const t = useT();
  const bump = useApp((s) => s.bump);
  if (!page.cover) return <div className="h-14" />;
  return (
    <div className="group relative h-44 w-full" style={{ background: page.cover }}>
      <div className="absolute bottom-3 right-6 hidden gap-2 group-hover:flex">
        <Button
          size="sm"
          onClick={async () => {
            const idx = COVERS.indexOf(page.cover!);
            await repos().pages.updateMeta(page.id, { cover: COVERS[(idx + 1) % COVERS.length] });
            bump();
          }}
        >
          {t('page.changeCover')}
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            await repos().pages.updateMeta(page.id, { cover: null });
            bump();
          }}
        >
          {t('page.removeCover')}
        </Button>
      </div>
    </div>
  );
}

function IconPicker({ page }: { page: Page }) {
  const t = useT();
  const bump = useApp((s) => s.bump);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const setIcon = async (icon: string | null) => {
    await repos().pages.updateMeta(page.id, { icon });
    bump();
    setAnchor(null);
  };
  return (
    <div className={cx('group flex items-end gap-2', page.cover ? '-mt-10' : 'mt-6')}>
      {page.icon ? (
        <button className="rounded-lg text-[56px] leading-none hover:bg-hover" onClick={(e) => setAnchor(e.currentTarget)} aria-label="Change icon">
          {page.icon}
        </button>
      ) : null}
      <div className="flex gap-1 pb-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {!page.icon && (
          <Button size="sm" variant="ghost" icon={<Smile className="size-3.5" />} onClick={(e) => setAnchor(e.currentTarget)}>
            {t('page.addIcon')}
          </Button>
        )}
        {!page.cover && (
          <Button
            size="sm"
            variant="ghost"
            icon={<ImageIcon className="size-3.5" />}
            onClick={async () => {
              await repos().pages.updateMeta(page.id, { cover: COVERS[Math.floor(Math.random() * COVERS.length)] });
              bump();
            }}
          >
            {t('page.addCover')}
          </Button>
        )}
      </div>
      <Popover anchor={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <div className="grid w-[280px] grid-cols-8 gap-0.5 p-1">
          {EMOJIS.map((e) => (
            <button key={e} className="rounded p-1 text-xl hover:bg-hover" onClick={() => void setIcon(e)}>
              {e}
            </button>
          ))}
        </div>
        {page.icon && (
          <button className="w-full rounded px-2 py-1 text-left text-sm text-muted hover:bg-hover" onClick={() => void setIcon(null)}>
            {t('common.remove')}
          </button>
        )}
      </Popover>
    </div>
  );
}

function PageHeaderBar({ page, editorRef, wordCount }: { page: Page; editorRef: React.RefObject<TEditor | null>; wordCount: number }) {
  const t = useT();
  const bump = useApp((s) => s.bump);
  const navigate = useApp((s) => s.navigate);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const html = () => editorRef.current?.getHTML() ?? '';
  const name = page.title || 'Untitled';
  const items = (): MenuItem[] => [
    { label: page.is_favorite ? t('page.unfavorite') : t('page.favorite'), icon: <Star className="size-3.5" />, onSelect: () => void toggleFavorite(page.id, !!page.is_favorite) },
    { label: page.is_pinned ? t('page.unpin') : t('page.pin'), icon: <Pin className="size-3.5" />, onSelect: () => void togglePinned(page.id, !!page.is_pinned) },
    {
      label: t('ai.summarize'),
      icon: <Sparkles className="size-3.5" />,
      disabled: page.kind !== 'page',
      onSelect: () => {
        const e = editorRef.current;
        if (!e) return;
        openAiPreview({
          action: 'summarize',
          label: t('ai.summarize'),
          original: e.getText(),
          onInsert: (md) => e.chain().focus('end').insertContent(markdownToHtml(`## Summary\n\n${md}`)).run(),
        });
      },
    },
    {
      label: t('ai.action_items'),
      icon: <Sparkles className="size-3.5" />,
      disabled: page.kind !== 'page',
      onSelect: () => {
        const e = editorRef.current;
        if (!e) return;
        e.commands.selectAll();
        runAiOnSelection(e, 'action_items');
      },
    },
    { separator: true, label: '' },
    { label: t('page.exportMd'), icon: <Download className="size-3.5" />, disabled: page.kind !== 'page', onSelect: () => void saveFile(`${name}.md`, `# ${name}\n\n${htmlToMarkdown(html())}`, [{ name: 'Markdown', extensions: ['md'] }]).catch(reportError) },
    { label: t('page.exportHtml'), icon: <Download className="size-3.5" />, disabled: page.kind !== 'page', onSelect: () => void saveFile(`${name}.html`, standaloneHtml(name, html()), [{ name: 'HTML', extensions: ['html'] }]).catch(reportError) },
    {
      label: t('page.exportDocx'),
      icon: <Download className="size-3.5" />,
      disabled: page.kind !== 'page',
      onSelect: () => void exportDocx(name, (editorRef.current?.getJSON() ?? null) as DocNode).catch(reportError),
    },
    { label: t('page.exportPdf'), icon: <Download className="size-3.5" />, disabled: page.kind !== 'page', onSelect: () => printHtml(standaloneHtml(name, html())) },
    {
      label: t('page.importMd'),
      icon: <Upload className="size-3.5" />,
      disabled: page.kind !== 'page' || !!page.deleted_at,
      onSelect: async () => {
        const [f] = await pickFiles('.md,.markdown,.txt', false);
        if (!f || !editorRef.current) return;
        const md = new TextDecoder().decode(f.bytes);
        editorRef.current.chain().focus('end').insertContent(markdownToHtml(md)).run();
      },
    },
    { separator: true, label: '' },
    { label: t('page.history'), icon: <History className="size-3.5" />, onSelect: () => setHistoryOpen(true) },
    { label: t('page.moveTo'), icon: <FolderInput className="size-3.5" />, onSelect: () => setMoveOpen(true) },
    {
      label: page.is_template ? `✓ ${t('page.saveAsTemplate')}` : t('page.saveAsTemplate'),
      icon: <LayoutTemplate className="size-3.5" />,
      onSelect: async () => {
        await repos().pages.updateMeta(page.id, { is_template: page.is_template ? 0 : 1 });
        bump();
      },
    },
    {
      label: t('common.duplicate'),
      icon: <Copy className="size-3.5" />,
      onSelect: async () => {
        const p = await repos().pages.duplicate(page.id);
        bump();
        navigate({ name: 'page', id: p.id });
      },
    },
    {
      label: page.archived_at ? t('page.unarchive') : t('page.archive'),
      icon: <Archive className="size-3.5" />,
      onSelect: async () => {
        await repos().pages.setArchived(page.id, !page.archived_at);
        bump();
      },
    },
    { label: t('page.moveToTrash'), icon: <Trash2 className="size-3.5" />, danger: true, onSelect: () => void trashPage(page.id) },
  ];
  return (
    <div className="flex h-9 items-center justify-end gap-1 text-xs text-faint">
      <span className="mr-2">
        {page.kind === 'page' && t('page.words', { n: wordCount })} · {relativeTime(page.updated_at, useApp.getState().lang)}
      </span>
      <IconButton label={page.is_favorite ? t('page.unfavorite') : t('page.favorite')} onClick={() => void toggleFavorite(page.id, !!page.is_favorite)}>
        <Star className={cx('size-4', !!page.is_favorite && 'fill-amber-400 text-amber-400')} />
      </IconButton>
      <MenuButton items={items} label="Page menu" align="end">
        <MoreHorizontal className="size-4" />
      </MenuButton>
      <HistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} page={page} editorRef={editorRef} />
      <MoveDialog open={moveOpen} onClose={() => setMoveOpen(false)} page={page} />
    </div>
  );
}

function HistoryDialog({ open, onClose, page, editorRef }: { open: boolean; onClose: () => void; page: Page; editorRef: React.RefObject<TEditor | null> }) {
  const t = useT();
  const { data } = useAsync(async () => (open ? repos().pages.listSnapshots(page.id) : []), [open, page.id]);
  return (
    <Modal open={open} onClose={onClose} title={t('page.history')} width={560}>
      {!data?.length && <p className="text-sm text-muted">—</p>}
      <ul className="divide-y divide-line">
        {data?.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              {new Date(s.created_at).toLocaleString()} · <span className="text-muted">{s.title || t('common.untitled')}</span>
            </span>
            <Button
              size="sm"
              icon={<RotateCcw className="size-3.5" />}
              onClick={async () => {
                if (!(await confirmDialog(t('page.restoreVersion')))) return;
                editorRef.current?.commands.setContent(JSON.parse(s.content_json), { emitUpdate: true });
                onClose();
              }}
            >
              {t('common.restore')}
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function MoveDialog({ open, onClose, page }: { open: boolean; onClose: () => void; page: Page }) {
  const t = useT();
  const bump = useApp((s) => s.bump);
  const [q, setQ] = useState('');
  const { data } = useAsync(async () => (open ? repos().pages.listTree(wsId()) : []), [open]);
  const list = (data ?? []).filter((p) => p.id !== page.id && (p.title || '').toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  const move = async (parent: string | null) => {
    try {
      await repos().pages.move(page.id, parent);
      bump();
      onClose();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('page.moveTo')} width={440}>
      <input className="mb-2 h-9 w-full rounded-lg border border-line-strong bg-elevated px-3 text-sm outline-none" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <button className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-hover" onClick={() => void move(null)}>
        ⌂ {t('page.moveRoot')}
      </button>
      {list.map((p) => (
        <button key={p.id} className="w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-hover" onClick={() => void move(p.id)}>
          {p.icon ?? '📄'} {p.title || t('common.untitled')}
        </button>
      ))}
    </Modal>
  );
}

function TagRow({ pageId }: { pageId: string }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const bump = useApp((s) => s.bump);
  const { data: tags } = useAsync(() => repos().pages.pageTags(pageId), [pageId, version]);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {tags?.map((tag) => (
        <Badge key={tag.id} color={tag.color}>
          #{tag.name}
          <button
            aria-label={`Remove tag ${tag.name}`}
            onClick={async () => {
              await repos().pages.removeTag(pageId, tag.id);
              bump();
            }}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <button
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-faint hover:bg-hover hover:text-muted"
        onClick={async () => {
          const name = await promptDialog(t('page.addTag'));
          if (!name?.trim()) return;
          const colors = ['blue', 'green', 'amber', 'violet', 'pink', 'teal', 'red'];
          await repos().pages.addTag(pageId, name, colors[name.length % colors.length]).catch(reportError);
          bump();
        }}
      >
        <TagIcon className="size-3" /> {t('page.addTag')}
      </button>
    </div>
  );
}

function PageLinkList({ title, pages, extra }: { title: string; pages: PageMeta[]; extra?: React.ReactNode }) {
  const t = useT();
  const navigate = useApp((s) => s.navigate);
  return (
    <section className="mt-10 border-t border-line pt-4">
      <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-faint">
        {title}
        {extra}
      </h2>
      <div className="grid gap-1 sm:grid-cols-2">
        {pages.map((p) => (
          <button key={p.id} onClick={() => navigate({ name: 'page', id: p.id })} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover">
            <span>{p.icon ?? <FileText className="size-4 text-muted" />}</span>
            <span className="truncate">{p.title || t('common.untitled')}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SubPages({ pageId }: { pageId: string }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const { data } = useAsync(async () => (await repos().pages.listTree(wsId())).filter((p) => p.parent_id === pageId), [pageId, version]);
  if (!data?.length) return null;
  return (
    <PageLinkList
      title={t('page.subpages')}
      pages={data}
      extra={
        <IconButton size="sm" label={t('page.addSubpage')} onClick={() => void createPage(pageId)}>
          <Plus className="size-3.5" />
        </IconButton>
      }
    />
  );
}

function Backlinks({ pageId }: { pageId: string }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const { data } = useAsync(() => repos().pages.backlinks(pageId), [pageId, version]);
  if (!data?.length) return null;
  return <PageLinkList title={`${t('page.backlinks')} · ${data.length}`} pages={data} extra={<Link2 className="size-3.5" />} />;
}

/** Local, offline similarity suggestions; links are only stored after approval. */
function RelatedNotes({ page }: { page: Page }) {
  const t = useT();
  const navigate = useApp((s) => s.navigate);
  const bump = useApp((s) => s.bump);
  const [items, setItems] = useState<{ id: string; title: string; icon: string | null; score: number }[] | null>(null);
  const run = async () => {
    const all = await repos().db.all<{ id: string; title: string; icon: string | null; content_text: string }>(
      "SELECT id, title, icon, content_text FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND id != ? AND kind = 'page'",
      [page.workspace_id, page.id],
    );
    const me = localHashEmbed(`${page.title}\n${page.content_text}`);
    const linked = new Set((await repos().pages.backlinks(page.id)).map((p) => p.id));
    setItems(
      all
        .map((p) => ({ id: p.id, title: p.title, icon: p.icon, score: cosine(me, localHashEmbed(`${p.title}\n${p.content_text.slice(0, 5000)}`)) }))
        .filter((p) => p.score > 0.2 && !linked.has(p.id))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    );
  };
  if (page.kind !== 'page' || page.deleted_at) return null;
  return (
    <section className="mt-6">
      {items === null ? (
        <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" />} onClick={() => void run()}>
          {t('page.relatedNotes')}
        </Button>
      ) : (
        <div className="rounded-lg border border-line p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{t('graph.suggestions')}</div>
          {!items.length && <div className="text-sm text-muted">{t('graph.noSuggestions')}</div>}
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 py-1 text-sm">
              <button className="flex-1 truncate text-left hover:underline" onClick={() => navigate({ name: 'page', id: it.id })}>
                {it.icon ?? '📄'} {it.title || t('common.untitled')}
              </button>
              <span className="text-xs text-faint">{Math.round(it.score * 100)}%</span>
              <Button
                size="sm"
                onClick={async () => {
                  await repos().links.suggest('page', page.id, 'page', it.id, it.score);
                  const [link] = (await repos().links.forItem('page', page.id)).filter((l) => l.to_id === it.id || l.from_id === it.id);
                  if (link) await repos().links.setStatus(link.id, 'approved');
                  setItems(items.filter((x) => x.id !== it.id));
                  bump();
                }}
              >
                {t('graph.approve')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await repos().links.suggest('page', page.id, 'page', it.id, it.score);
                  const [link] = (await repos().links.forItem('page', page.id)).filter((l) => l.to_id === it.id);
                  if (link) await repos().links.setStatus(link.id, 'rejected');
                  setItems(items.filter((x) => x.id !== it.id));
                }}
              >
                {t('graph.reject')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
