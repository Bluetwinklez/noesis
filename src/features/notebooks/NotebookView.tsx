import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  BookMarked,
  FileQuestion,
  FileText,
  GitCompare,
  Layers,
  ListChecks,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Clock,
  Newspaper,
  Save,
  Library,
  X,
} from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT, type MessageKey } from '../../i18n';
import { Button, confirmDialog, cx, EmptyState, IconButton, MenuButton, Modal, promptDialog, Spinner, Tabs, Textarea, useAsync, type MenuItem } from '../../components/ui';
import { errorMessage, providerWithConsent, reportError } from '../../app/services';
import { answerQuestion, noEvidenceMessage } from '../../ai/rag';
import { generateFlashcards, generateQuiz, generateStudioDoc, type SourceDoc, type StudioKind, type Flashcard, type QuizQuestion } from '../../ai/assistant';
import type { ChatMessage, Citation, NotebookNote, Source } from '../../core/types';
import { AddSourceButtons, StatusBadge } from '../sources/SourcesPage';
import { Markdown } from '../ai/AiPreview';
import { markdownToHtml } from '../../editor/markdown';
import { AudioStudio } from './AudioStudio';
import { createPage } from '../actions';

type NbSource = Source & { selected: number };

export default function NotebookView({ id }: { id: string }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const bump = useApp((s) => s.bump);
  const navigate = useApp((s) => s.navigate);
  const { data: nb } = useAsync(() => repos().notebooks.get(id), [id, version]);
  const { data: sources } = useAsync(() => repos().notebooks.sources(id), [id, version]);
  const [rightTab, setRightTab] = useState<'studio' | 'notes'>('studio');
  const [openNote, setOpenNote] = useState<NotebookNote | null>(null);

  const busy = (sources ?? []).some((s) => s.status === 'processing' || s.status === 'pending');
  useEffect(() => {
    if (!busy) return;
    const h = setInterval(bump, 1500);
    return () => clearInterval(h);
  }, [busy, bump]);

  if (nb === undefined) return <div className="flex h-40 items-center justify-center"><Spinner /></div>;
  if (!nb) return <EmptyState title={t('page.notFound')} />;

  const selected = (sources ?? []).filter((s) => s.selected && s.status === 'ready');
  const menu = (): MenuItem[] => [
    {
      label: t('nb.rename'),
      icon: <Pencil className="size-3.5" />,
      onSelect: async () => {
        const title = await promptDialog(t('nb.rename'), nb.title);
        if (title?.trim()) {
          await repos().notebooks.update(id, { title: title.trim() });
          bump();
        }
      },
    },
    {
      label: t('common.description'),
      icon: <FileText className="size-3.5" />,
      onSelect: async () => {
        const d = await promptDialog(t('common.description'), nb.description);
        if (d !== null) {
          await repos().notebooks.update(id, { description: d });
          bump();
        }
      },
    },
    {
      label: t('nb.clearChat'),
      icon: <X className="size-3.5" />,
      onSelect: async () => {
        await repos().notebooks.clearChat(id);
        bump();
      },
    },
    {
      label: t('common.delete'),
      icon: <Trash2 className="size-3.5" />,
      danger: true,
      onSelect: async () => {
        if (!(await confirmDialog(t('common.delete'), t('nb.deleteConfirm'), { danger: true }))) return;
        await repos().notebooks.remove(id);
        bump();
        navigate({ name: 'notebooks' }, { replace: true });
      },
    },
  ];

  return (
    <div className="flex h-full min-h-0">
      <SourcesPanel notebookId={id} sources={sources ?? []} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line px-6 py-3">
          <span className="text-2xl">{nb.icon ?? '📓'}</span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-semibold">{nb.title}</h1>
            {nb.description && <p className="truncate text-xs text-muted">{nb.description}</p>}
          </div>
          <MenuButton items={menu} label="Notebook menu" align="end">
            <MoreHorizontal className="size-4" />
          </MenuButton>
        </div>
        <ChatPanel notebookId={id} selected={selected} hasSources={(sources ?? []).length > 0} onSaved={() => setRightTab('notes')} />
      </div>
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-sidebar/60 max-xl:hidden" aria-label={t('nb.studio')}>
        <div className="border-b border-line px-4 py-2.5">
          <Tabs
            value={rightTab}
            onChange={setRightTab}
            tabs={[
              { value: 'studio', label: <><Sparkles className="size-3.5" />{t('nb.studio')}</> },
              { value: 'notes', label: <><NotebookPen className="size-3.5" />{t('nb.notes')}</> },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {rightTab === 'studio' ? (
            <StudioPanel notebookId={id} selected={selected} onCreated={(n) => (setRightTab('notes'), setOpenNote(n))} />
          ) : (
            <NotesPanel notebookId={id} onOpen={setOpenNote} />
          )}
        </div>
      </aside>
      {openNote && <NoteDialog note={openNote} onClose={() => setOpenNote(null)} />}
    </div>
  );
}

function SourcesPanel({ notebookId, sources }: { notebookId: string; sources: NbSource[] }) {
  const t = useT();
  const bump = useApp((s) => s.bump);
  const navigate = useApp((s) => s.navigate);
  const [libOpen, setLibOpen] = useState(false);
  const { data: library } = useAsync(async () => (libOpen ? repos().sources.list(wsId()) : []), [libOpen]);
  const ready = sources.filter((s) => s.status === 'ready');
  const allSelected = ready.length > 0 && ready.every((s) => s.selected);
  const add = async (ids: string[]) => {
    for (const sid of ids) await repos().notebooks.addSource(notebookId, sid);
    bump();
  };
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-sidebar/60 max-lg:hidden" aria-label={t('nb.sources')}>
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <div className="text-sm font-semibold">{t('nb.sources')}</div>
        <IconButton label={t('nb.addExisting')} onClick={() => setLibOpen(true)}>
          <Library className="size-4" />
        </IconButton>
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3 [&_button]:h-7 [&_button]:px-2 [&_button]:text-xs">
        <AddSourceButtons onAdded={(ids) => void add(ids)} />
      </div>
      {ready.length > 0 && (
        <label className="mx-4 mb-1 flex items-center gap-2 border-b border-line pb-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={async (e) => {
              await repos().notebooks.setAllSelected(notebookId, e.target.checked);
              bump();
            }}
            className="accent-[var(--accent)]"
          />
          {t('nb.selectAll')}
          <span className="ml-auto">{t('nb.selectedCount', { n: ready.filter((s) => s.selected).length, total: sources.length })}</span>
        </label>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sources.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted">{t('nb.noSources')}</p>}
        {sources.map((s) => (
          <div key={s.id} className="group flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-hover">
            <input
              type="checkbox"
              aria-label={`Use ${s.title}`}
              disabled={s.status !== 'ready'}
              checked={!!s.selected && s.status === 'ready'}
              onChange={async (e) => {
                await repos().notebooks.setSelected(notebookId, s.id, e.target.checked);
                bump();
              }}
              className="mt-1 accent-[var(--accent)]"
            />
            <button className="min-w-0 flex-1 text-left" onClick={() => navigate({ name: 'sources', id: s.id })}>
              <div className="truncate text-[13px] font-medium">{s.title}</div>
              {s.status === 'ready' ? <div className="text-[11px] text-faint uppercase">{t(`src.kind.${s.kind}` as MessageKey)}</div> : <StatusBadge s={s} />}
              {s.status === 'error' && <div className="mt-0.5 line-clamp-3 text-[11px] text-danger">{s.error}</div>}
            </button>
            <IconButton
              size="sm"
              label={t('common.remove')}
              className="opacity-0 group-hover:opacity-100"
              onClick={async () => {
                await repos().notebooks.removeSource(notebookId, s.id);
                bump();
              }}
            >
              <X className="size-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
      <Modal open={libOpen} onClose={() => setLibOpen(false)} title={t('nb.addExisting')}>
        {(library ?? []).filter((l) => !sources.some((s) => s.id === l.id)).map((l) => (
          <button
            key={l.id}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-hover"
            onClick={async () => {
              await add([l.id]);
              setLibOpen(false);
            }}
          >
            <span className="flex-1 truncate">{l.title}</span>
            <StatusBadge s={l} />
          </button>
        ))}
        {library?.length === 0 && <p className="text-sm text-muted">{t('src.empty')}</p>}
      </Modal>
    </aside>
  );
}

function CitationChip({ c, onOpen }: { c: Citation; onOpen: (c: Citation) => void }) {
  return (
    <button
      onClick={() => onOpen(c)}
      title={`${c.sourceTitle}${c.pageNumber ? ` · p. ${c.pageNumber}` : ''}\n\n${c.excerpt}`}
      className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-soft px-1 align-text-top text-[11px] font-semibold text-accent hover:bg-accent hover:text-white"
    >
      {c.n}
    </button>
  );
}

/** Renders an answer, turning [n] markers into clickable citation chips. */
function AnswerText({ text, citations, onOpen }: { text: string; citations: Citation[]; onOpen: (c: Citation) => void }) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const parts = text.split(/(\[\d+\])/g);
  // Markdown per segment would break lists; render markdown and replace markers via placeholders.
  const placeholder = (n: number) => `@@CITE${n}@@`;
  const md = parts.map((p) => (/^\[\d+\]$/.test(p) && byN.has(Number(p.slice(1, -1))) ? placeholder(Number(p.slice(1, -1))) : p)).join('');
  const ref = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<{ el: HTMLElement; c: Citation }[]>([]);
  useEffect(() => {
    if (!ref.current) return;
    const walker = document.createTreeWalker(ref.current, NodeFilter.SHOW_TEXT);
    const found: Text[] = [];
    while (walker.nextNode()) if (/@@CITE\d+@@/.test(walker.currentNode.nodeValue ?? '')) found.push(walker.currentNode as Text);
    const created: { el: HTMLElement; c: Citation }[] = [];
    for (const tn of found) {
      const frag = document.createDocumentFragment();
      for (const piece of (tn.nodeValue ?? '').split(/(@@CITE\d+@@)/)) {
        const m = piece.match(/^@@CITE(\d+)@@$/);
        if (m && byN.has(Number(m[1]))) {
          const span = document.createElement('span');
          created.push({ el: span, c: byN.get(Number(m[1]))! });
          frag.appendChild(span);
        } else frag.appendChild(document.createTextNode(piece));
      }
      tn.replaceWith(frag);
    }
    setNodes(created);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md]);
  return (
    <div ref={ref}>
      <Markdown text={md} />
      {nodes.map(({ el, c }, i) => (
        <PortalChip key={i} el={el} c={c} onOpen={onOpen} />
      ))}
    </div>
  );
}

function PortalChip({ el, c, onOpen }: { el: HTMLElement; c: Citation; onOpen: (c: Citation) => void }) {
  return createPortal(<CitationChip c={c} onOpen={onOpen} />, el);
}

function openCitation(c: Citation) {
  useApp.getState().navigate({ name: 'sources', id: c.sourceId, highlight: c.charEnd > c.charStart ? { start: c.charStart, end: c.charEnd } : undefined });
}

function ChatPanel({ notebookId, selected, hasSources, onSaved }: { notebookId: string; selected: NbSource[]; hasSources: boolean; onSaved: () => void }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const version = useApp((s) => s.version);
  const bump = useApp((s) => s.bump);
  const { data: messages } = useAsync(() => repos().notebooks.messages(notebookId), [notebookId, version]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [pendingQ, setPendingQ] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streaming]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const ask = async (question: string) => {
    if (!question.trim() || streaming !== null) return;
    if (!selected.length) return useApp.getState().toast(t('nb.noSelected'), 'error');
    setInput('');
    setPendingQ(question);
    const c = new AbortController();
    ctrl.current = c;
    let partial = '';
    try {
      const provider = await providerWithConsent();
      await repos().notebooks.addMessage({ notebook_id: notebookId, role: 'user', content: question, citations: [], status: 'complete' });
      setPendingQ(null);
      bump();
      setStreaming('');
      const history = (messages ?? []).filter((m) => m.status === 'complete').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const res = await answerQuestion(repos().db, provider, question, {
        sourceIds: selected.map((s) => s.id),
        history,
        lang,
        signal: c.signal,
        onToken: (d) => {
          partial += d;
          setStreaming(partial);
        },
      });
      await repos().notebooks.addMessage({ notebook_id: notebookId, role: 'assistant', content: res.text, citations: res.citations, status: 'complete' });
    } catch (e) {
      setPendingQ(null);
      const cancelled = c.signal.aborted;
      if (partial || cancelled) {
        await repos().notebooks.addMessage({
          notebook_id: notebookId,
          role: 'assistant',
          content: partial || '—',
          citations: [],
          status: cancelled ? 'cancelled' : 'error',
        });
      }
      if (!cancelled) reportError(e);
    } finally {
      setStreaming(null);
      bump();
    }
  };

  const suggestions = useMemo(
    () =>
      lang === 'tr'
        ? ['Bu kaynakların ana fikirleri neler?', 'Önemli terimleri açıkla', 'Kaynaklar hangi konularda farklılaşıyor?']
        : ['What are the main ideas in these sources?', 'Explain the key terms', 'Where do the sources disagree?'],
    [lang],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6" aria-live="polite">
        <div className="mx-auto max-w-[760px] space-y-5">
          {!messages?.length && streaming === null && (
            <div className="py-10 text-center">
              <Sparkles className="mx-auto mb-3 size-8 text-accent" />
              <p className="mb-4 text-sm text-muted">{hasSources ? t('nb.askPlaceholder') : t('nb.noSources')}</p>
              {hasSources && (
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => void ask(s)} className="rounded-full border border-line bg-elevated px-3 py-1.5 text-[13px] text-muted hover:border-accent hover:text-accent">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages?.map((m) => <MessageBubble key={m.id} m={m} notebookId={notebookId} onSaved={onSaved} />)}
          {pendingQ && <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-white opacity-70">{pendingQ}</div>}
          {streaming !== null && (
            <div className="rounded-2xl border border-line bg-elevated px-4 py-3 text-sm">
              {streaming ? <Markdown text={streaming} /> : <span className="flex items-center gap-2 text-muted"><Spinner className="size-3.5" /> {t('ai.generating')}</span>}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <div className="border-t border-line px-6 py-3">
        <form
          className="mx-auto flex max-w-[760px] items-end gap-2 rounded-2xl border border-line-strong bg-elevated p-2 shadow-sm focus-within:border-accent"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={1}
            placeholder={selected.length ? t('nb.askPlaceholder') : t('nb.noSelected')}
            aria-label={t('nb.askPlaceholder')}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-faint"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <span className="pb-2 text-[11px] text-faint">{t('nb.selectedCount', { n: selected.length, total: selected.length })}</span>
          {streaming !== null ? (
            <IconButton label={t('common.stop')} onClick={() => ctrl.current?.abort()} className="bg-hover">
              <Square className="size-4" />
            </IconButton>
          ) : (
            <IconButton label={t('ai.ask')} type="submit" disabled={!input.trim() || !selected.length} className="bg-accent text-white hover:bg-accent-strong hover:text-white">
              <ArrowUp className="size-4" />
            </IconButton>
          )}
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ m, notebookId, onSaved }: { m: ChatMessage; notebookId: string; onSaved: () => void }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const bump = useApp((s) => s.bump);
  if (m.role === 'user') return <div className="ml-auto w-fit max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-white">{m.content}</div>;
  const insufficient = m.content.startsWith(noEvidenceMessage(lang)) || m.content.startsWith(noEvidenceMessage(lang === 'tr' ? 'en' : 'tr'));
  return (
    <div className={cx('group rounded-2xl border bg-elevated px-4 py-3 text-sm', m.status === 'error' ? 'border-danger/40' : 'border-line')}>
      {insufficient && <div className="mb-2 inline-flex items-center gap-1 rounded-md bg-warning/12 px-2 py-0.5 text-xs text-warning"><FileQuestion className="size-3" /> {t('nb.insufficient')}</div>}
      <AnswerText text={m.content} citations={m.citations} onOpen={openCitation} />
      {m.status === 'cancelled' && <div className="mt-1 text-xs text-faint">— {t('common.stop')}</div>}
      {m.citations.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{t('nb.citations')}</div>
          <div className="space-y-1">
            {m.citations.map((c) => (
              <button key={c.n} onClick={() => openCitation(c)} className="flex w-full items-start gap-2 rounded-md p-1.5 text-left hover:bg-hover">
                <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">{c.n}</span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {c.sourceTitle}
                    {c.pageNumber ? ` · p. ${c.pageNumber}` : ''}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted">{c.excerpt}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          size="sm"
          variant="ghost"
          icon={<Save className="size-3.5" />}
          onClick={async () => {
            await repos().notebooks.addNote(notebookId, 'note', m.content.slice(0, 60).replace(/\n/g, ' '), m.content, {}, m.citations);
            bump();
            onSaved();
          }}
        >
          {t('nb.saveToNote')}
        </Button>
        <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => void saveAsPage(m.content.slice(0, 60), m.content, m.citations)}>
          {t('nb.saveToPage')}
        </Button>
      </div>
    </div>
  );
}

async function saveAsPage(title: string, md: string, citations: Citation[]) {
  const refs = citations.length
    ? `\n\n---\n\n**Sources**\n\n${citations.map((c) => `${c.n}. ${c.sourceTitle}${c.pageNumber ? `, p. ${c.pageNumber}` : ''} — “${c.excerpt.slice(0, 160)}”`).join('\n')}`
    : '';
  const page = await createPage(null, title.replace(/[#*\n]/g, '').trim());
  if (!page) return;
  // Convert via the editor's HTML pipeline on next mount: store as doc from HTML using a temporary editor-free path.
  const { generateJSON } = await import('@tiptap/core');
  const StarterKit = (await import('@tiptap/starter-kit')).default;
  const doc = generateJSON(markdownToHtml(md + refs), [StarterKit]);
  await repos().pages.saveContent(page.id, doc as never);
  useApp.getState().navigate({ name: 'page', id: page.id }, { replace: true });
  useApp.getState().bump();
}

const STUDIO: { kind: StudioKind | 'flashcards' | 'quiz'; icon: React.ReactNode; label: MessageKey }[] = [
  { kind: 'summary', icon: <FileText className="size-4" />, label: 'nb.studio.summary' },
  { kind: 'study_guide', icon: <BookMarked className="size-4" />, label: 'nb.studio.study_guide' },
  { kind: 'faq', icon: <FileQuestion className="size-4" />, label: 'nb.studio.faq' },
  { kind: 'timeline', icon: <Clock className="size-4" />, label: 'nb.studio.timeline' },
  { kind: 'briefing', icon: <Newspaper className="size-4" />, label: 'nb.studio.briefing' },
  { kind: 'comparison', icon: <GitCompare className="size-4" />, label: 'nb.studio.comparison' },
  { kind: 'flashcards', icon: <Layers className="size-4" />, label: 'nb.studio.flashcards' },
  { kind: 'quiz', icon: <ListChecks className="size-4" />, label: 'nb.studio.quiz' },
];

async function loadSourceDocs(selected: NbSource[]): Promise<SourceDoc[]> {
  const out: SourceDoc[] = [];
  for (const s of selected) {
    const full = await repos().sources.get(s.id);
    if (full?.text_content) out.push({ id: s.id, title: s.title, text: full.text_content });
  }
  return out;
}

function StudioPanel({ notebookId, selected, onCreated }: { notebookId: string; selected: NbSource[]; onCreated: (n: NotebookNote) => void }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const bump = useApp((s) => s.bump);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState('');
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const run = async (kind: (typeof STUDIO)[number]['kind'], label: string) => {
    if (!selected.length) return setError(t('nb.noSelected'));
    setError('');
    setRunning(kind);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const provider = await providerWithConsent();
      const docs = await loadSourceDocs(selected);
      let note: NotebookNote;
      if (kind === 'flashcards') {
        const cards = await generateFlashcards(provider, docs, lang, 12, c.signal);
        note = await repos().notebooks.addNote(notebookId, 'flashcards', label, cards.map((x) => `**${x.front}**\n\n${x.back}`).join('\n\n---\n\n'), { cards });
      } else if (kind === 'quiz') {
        const questions = await generateQuiz(provider, docs, lang, 8, c.signal);
        note = await repos().notebooks.addNote(notebookId, 'quiz', label, questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n'), { questions });
      } else {
        const { markdown, citations } = await generateStudioDoc(provider, kind, docs, lang, c.signal);
        note = await repos().notebooks.addNote(notebookId, kind, label, markdown, {}, citations);
      }
      bump();
      onCreated(note);
    } catch (e) {
      if (!c.signal.aborted) setError(errorMessage(e));
    } finally {
      setRunning(null);
    }
  };
  return (
    <div className="space-y-5">
      <AudioStudio notebookId={notebookId} selected={selected} loadDocs={() => loadSourceDocs(selected)} />
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{t('nb.studio')}</div>
        <div className="grid grid-cols-2 gap-2">
          {STUDIO.map((s) => (
            <button
              key={s.kind}
              disabled={!!running}
              onClick={() => void run(s.kind, t(s.label))}
              className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2.5 text-left text-[13px] hover:border-accent disabled:opacity-50"
            >
              <span className="text-accent">{running === s.kind ? <Spinner className="size-4" /> : s.icon}</span>
              {t(s.label)}
            </button>
          ))}
        </div>
        {running && (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => ctrl.current?.abort()}>
            {t('common.stop')}
          </Button>
        )}
        {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
      </div>
    </div>
  );
}

function NotesPanel({ notebookId, onOpen }: { notebookId: string; onOpen: (n: NotebookNote) => void }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const bump = useApp((s) => s.bump);
  const { data } = useAsync(() => repos().notebooks.notes(notebookId), [notebookId, version]);
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        icon={<Plus className="size-3.5" />}
        onClick={async () => {
          const n = await repos().notebooks.addNote(notebookId, 'note', t('nb.newNote'), '');
          bump();
          onOpen(n);
        }}
      >
        {t('nb.newNote')}
      </Button>
      {data?.map((n) => (
        <button key={n.id} onClick={() => onOpen(n)} className="block w-full rounded-lg border border-line bg-elevated p-3 text-left hover:border-accent">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent">{n.kind.replace('_', ' ')}</div>
          <div className="truncate text-sm font-medium">{n.title}</div>
          <div className="line-clamp-2 text-xs text-muted">{n.content_md.replace(/[#*>`]/g, '')}</div>
        </button>
      ))}
    </div>
  );
}

function NoteDialog({ note, onClose }: { note: NotebookNote; onClose: () => void }) {
  const t = useT();
  const bump = useApp((s) => s.bump);
  const [editing, setEditing] = useState(note.kind === 'note' && !note.content_md);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.content_md);
  const save = async () => {
    await repos().notebooks.updateNote(note.id, { title, content_md: body });
    bump();
    setEditing(false);
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={780}
      title={editing ? <input className="w-full bg-transparent outline-none" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Note title" /> : title}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-danger"
            onClick={async () => {
              if (!(await confirmDialog(t('common.delete'), undefined, { danger: true }))) return;
              await repos().notebooks.removeNote(note.id);
              bump();
              onClose();
            }}
          >
            {t('common.delete')}
          </Button>
          <Button variant="ghost" onClick={() => void saveAsPage(title, body, note.citations)}>
            {t('nb.saveToPage')}
          </Button>
          {editing ? (
            <Button variant="primary" onClick={() => void save()}>
              {t('common.save')}
            </Button>
          ) : (
            note.kind !== 'flashcards' && note.kind !== 'quiz' && (
              <Button icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )
          )}
        </>
      }
    >
      {note.kind === 'flashcards' && Array.isArray(note.data.cards) ? (
        <Flashcards cards={note.data.cards as Flashcard[]} />
      ) : note.kind === 'quiz' && Array.isArray(note.data.questions) ? (
        <Quiz questions={note.data.questions as QuizQuestion[]} />
      ) : editing ? (
        <Textarea rows={18} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-[13px]" aria-label="Note body (Markdown)" />
      ) : (
        <AnswerText text={body} citations={note.citations} onOpen={(c) => (onClose(), openCitation(c))} />
      )}
    </Modal>
  );
}

function Flashcards({ cards }: { cards: Flashcard[] }) {
  const t = useT();
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[i];
  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={() => setFlipped((f) => !f)}
        className="flex min-h-56 w-full max-w-lg items-center justify-center rounded-2xl border border-line bg-gradient-to-br from-accent-soft to-elevated p-8 text-center text-lg shadow-soft"
        aria-label={t('nb.flip')}
      >
        {flipped ? <Markdown text={card.back} /> : <span className="font-semibold">{card.front}</span>}
      </button>
      <div className="flex items-center gap-3 text-sm text-muted">
        <Button size="sm" disabled={i === 0} onClick={() => (setI(i - 1), setFlipped(false))}>
          ←
        </Button>
        {t('nb.cardOf', { i: i + 1, n: cards.length })} · {t('nb.flip')}
        <Button size="sm" disabled={i === cards.length - 1} onClick={() => (setI(i + 1), setFlipped(false))}>
          →
        </Button>
      </div>
    </div>
  );
}

function Quiz({ questions }: { questions: QuizQuestion[] }) {
  const t = useT();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const score = questions.filter((q, i) => answers[i] === q.answer).length;
  return (
    <div className="space-y-5">
      {questions.map((q, i) => (
        <fieldset key={i}>
          <legend className="mb-2 text-sm font-medium">
            {i + 1}. {q.question}
          </legend>
          <div className="space-y-1">
            {q.options.map((o, j) => (
              <label
                key={j}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                  checked && j === q.answer ? 'border-success bg-success/10' : checked && answers[i] === j ? 'border-danger bg-danger/10' : 'border-line',
                )}
              >
                <input type="radio" name={`q${i}`} checked={answers[i] === j} onChange={() => setAnswers({ ...answers, [i]: j })} disabled={checked} className="accent-[var(--accent)]" />
                {o}
              </label>
            ))}
          </div>
          {checked && <p className="mt-1 text-xs text-muted">{q.explanation}</p>}
        </fieldset>
      ))}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => setChecked(true)} disabled={checked}>
          {t('nb.checkAnswers')}
        </Button>
        {checked && <span className="text-sm font-semibold">{t('nb.quizScore', { s: score, n: questions.length })}</span>}
        {checked && (
          <Button variant="ghost" onClick={() => (setAnswers({}), setChecked(false))}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}

