import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardPaste, FileUp, Globe, Library, Loader2, MoreHorizontal, RefreshCw, Trash2, X, BookOpen } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT, type MessageKey } from '../../i18n';
import { Badge, Button, confirmDialog, cx, EmptyState, IconButton, Input, MenuButton, Modal, PageHeader, Spinner, Textarea, useAsync, type MenuItem } from '../../components/ui';
import { ingestion, reportError } from '../../app/services';
import { pickFiles, readFiles } from '../../lib/platform';
import { ACCEPTED_FILE_TYPES } from '../../ingestion/extractors';
import { formatBytes, relativeTime } from '../../lib/util';
import type { Source } from '../../core/types';
import { stageIndex } from '../../ingestion/pipeline';

const KIND_EMOJI: Record<string, string> = {
  pdf: '📕',
  docx: '📘',
  txt: '📄',
  markdown: '📝',
  html: '🌐',
  url: '🔗',
  csv: '📊',
  image: '🖼️',
  audio: '🎧',
  youtube: '▶️',
  note: '🗒️',
};

export function StatusBadge({ s }: { s: Pick<Source, 'status' | 'stage'> }) {
  const t = useT();
  if (s.status === 'ready')
    return (
      <Badge color="green">
        <CheckCircle2 className="size-3" /> {t('src.status.ready')}
      </Badge>
    );
  if (s.status === 'error')
    return (
      <Badge color="red">
        <AlertCircle className="size-3" /> {t('src.status.error')}
      </Badge>
    );
  return (
    <Badge color="blue">
      <Loader2 className="size-3 animate-spin" /> {s.status === 'pending' ? t('src.status.pending') : s.stage}
    </Badge>
  );
}

/** Shared import actions used by the library and notebooks. Returns created source ids. */
export async function importFiles(files: { name: string; bytes: Uint8Array; mime: string }[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    const s = await ingestion().importFile(wsId(), f);
    ids.push(s.id);
    useApp.getState().bump();
    if (s.status !== 'error') void ingestion().process(s.id).then(() => useApp.getState().bump());
  }
  return ids;
}

export async function importUrl(url: string): Promise<string> {
  const s = await ingestion().importUrl(wsId(), url);
  useApp.getState().bump();
  void ingestion().process(s.id).then(() => useApp.getState().bump());
  return s.id;
}

export async function importPasted(title: string, text: string): Promise<string> {
  const s = await ingestion().importText(wsId(), title, text);
  useApp.getState().bump();
  await ingestion().process(s.id);
  useApp.getState().bump();
  return s.id;
}

export function AddSourceButtons({ onAdded }: { onAdded?: (ids: string[]) => void }) {
  const t = useT();
  const [urlOpen, setUrlOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  return (
    <>
      <Button
        variant="primary"
        icon={<FileUp className="size-4" />}
        onClick={async () => {
          const files = await pickFiles(ACCEPTED_FILE_TYPES);
          if (!files.length) return;
          const ids = await importFiles(files).catch((e) => (reportError(e), [] as string[]));
          onAdded?.(ids);
        }}
      >
        {t('src.import')}
      </Button>
      <Button icon={<Globe className="size-4" />} onClick={() => setUrlOpen(true)}>
        {t('src.addUrl')}
      </Button>
      <Button icon={<ClipboardPaste className="size-4" />} onClick={() => setPasteOpen(true)}>
        {t('src.paste')}
      </Button>
      <Modal
        open={urlOpen}
        onClose={() => setUrlOpen(false)}
        title={t('src.addUrl')}
        footer={
          <Button
            variant="primary"
            disabled={!url.trim()}
            onClick={async () => {
              setUrlOpen(false);
              const id = await importUrl(url).catch((e) => (reportError(e), null));
              setUrl('');
              if (id) onAdded?.([id]);
            }}
          >
            {t('common.add')}
          </Button>
        }
      >
        <Input autoFocus placeholder={t('src.urlPlaceholder')} value={url} onChange={(e) => setUrl(e.target.value)} />
        <p className="mt-2 text-xs text-muted">{t('settings.privacyIntro').split('.')[0]}.</p>
      </Modal>
      <Modal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title={t('src.paste')}
        width={640}
        footer={
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={async () => {
              setPasteOpen(false);
              const id = await importPasted(title, text).catch((e) => (reportError(e), null));
              setTitle('');
              setText('');
              if (id) onAdded?.([id]);
            }}
          >
            {t('common.add')}
          </Button>
        }
      >
        <Input placeholder={t('src.pasteTitle')} value={title} onChange={(e) => setTitle(e.target.value)} className="mb-2" />
        <Textarea rows={12} placeholder={t('src.pasteBody')} value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
    </>
  );
}

function Pipeline({ s }: { s: Source }) {
  const stages = ['validation', 'extraction', 'normalization', 'chunking', 'embedding', 'indexing'] as const;
  const cur = stageIndex(s.stage);
  return (
    <div className="flex items-center gap-1" aria-label={`Pipeline stage ${s.stage}`}>
      {stages.map((st) => {
        const i = stageIndex(st);
        const done = s.status === 'ready' || i < cur;
        const failed = s.status === 'error' && i === cur;
        return (
          <div key={st} title={st} className={cx('h-1.5 flex-1 rounded-full', failed ? 'bg-danger' : done ? 'bg-success' : i === cur && s.status === 'processing' ? 'bg-accent animate-pulse' : 'bg-active')} />
        );
      })}
    </div>
  );
}

export default function SourcesPage() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const version = useApp((s) => s.version);
  const route = useApp((s) => s.route);
  const selectedId = route.name === 'sources' ? route.id : undefined;
  const highlight = route.name === 'sources' ? route.highlight : undefined;
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState('');
  const { data: list } = useAsync(() => repos().sources.list(wsId()), [version]);
  const shown = useMemo(() => (list ?? []).filter((s) => s.title.toLowerCase().includes(filter.toLowerCase())), [list, filter]);

  // Light polling while something is processing (progress events also bump).
  const busy = (list ?? []).some((s) => s.status === 'processing' || s.status === 'pending');
  useEffect(() => {
    if (!busy) return;
    const h = setInterval(() => useApp.getState().bump(), 1500);
    return () => clearInterval(h);
  }, [busy]);

  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        const files = await readFiles(Array.from(e.dataTransfer.files));
        await importFiles(files).catch(reportError);
      }}
    >
      <div className={cx('min-w-0 flex-1 overflow-y-auto px-8 py-10', selectedId && 'hidden lg:block')}>
        <div className="mx-auto max-w-[900px]">
          <PageHeader icon={<Library className="size-5" />} title={t('src.title')} subtitle={t('src.supported')} actions={<AddSourceButtons />} />
          {dragOver && <div className="mb-4 rounded-xl border-2 border-dashed border-accent bg-accent-soft p-8 text-center text-sm font-medium text-accent">{t('src.drop')}</div>}
          {list && list.length > 0 && <Input className="mb-3 max-w-xs" placeholder={t('common.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />}
          {list?.length === 0 ? (
            <EmptyState icon={<Library className="size-5" />} title={t('src.title')} body={t('src.empty')} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-elevated">
              {shown.map((s, i) => (
                <SourceRow key={s.id} s={s} first={i === 0} active={s.id === selectedId} lang={lang} />
              ))}
            </div>
          )}
        </div>
      </div>
      {selectedId && <SourcePreview key={selectedId} id={selectedId} highlight={highlight} />}
    </div>
  );
}

function SourceRow({ s, first, active, lang }: { s: Source; first: boolean; active: boolean; lang: string }) {
  const t = useT();
  const navigate = useApp((st) => st.navigate);
  const bump = useApp((st) => st.bump);
  const items = (): MenuItem[] => [
    {
      label: t('src.reprocess'),
      icon: <RefreshCw className="size-3.5" />,
      disabled: ingestion().isRunning(s.id),
      onSelect: () => void ingestion().process(s.id).then(bump),
    },
    { label: t('src.cancel'), icon: <X className="size-3.5" />, disabled: !ingestion().isRunning(s.id), onSelect: () => ingestion().cancel(s.id) },
    {
      label: t('common.delete'),
      icon: <Trash2 className="size-3.5" />,
      danger: true,
      onSelect: async () => {
        if (!(await confirmDialog(t('common.delete'), t('src.deleteConfirm'), { danger: true }))) return;
        ingestion().cancel(s.id);
        await repos().sources.remove(s.id);
        bump();
      },
    },
  ];
  return (
    <div className={cx('group flex items-center gap-3 px-4 py-3', !first && 'border-t border-line', active && 'bg-accent-soft/50')}>
      <span className="text-xl">{KIND_EMOJI[s.kind] ?? '📄'}</span>
      <button className="min-w-0 flex-1 text-left" onClick={() => navigate({ name: 'sources', id: s.id })}>
        <div className="truncate text-sm font-medium">{s.title}</div>
        <div className="truncate text-xs text-faint">
          {t(`src.kind.${s.kind}` as MessageKey)} {s.size ? `· ${formatBytes(s.size)}` : ''} {s.page_count ? `· ${t('src.pages', { n: s.page_count })}` : ''} · {relativeTime(s.created_at, lang)}
        </div>
        {s.status === 'error' && <div className="mt-1 text-xs text-danger">{s.error}</div>}
        {s.status !== 'ready' && s.status !== 'error' && (
          <div className="mt-1.5 w-48">
            <Pipeline s={s} />
          </div>
        )}
      </button>
      <StatusBadge s={s} />
      <MenuButton items={items} label="Source actions" align="end">
        <MoreHorizontal className="size-4" />
      </MenuButton>
    </div>
  );
}

function SourcePreview({ id, highlight }: { id: string; highlight?: { start: number; end: number } }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const navigate = useApp((s) => s.navigate);
  const { data } = useAsync(async () => {
    const s = await repos().sources.get(id);
    return { s, chunks: s ? await repos().sources.chunkCount(id) : 0, notebooks: await repos().notebooks.list(wsId()) };
  }, [id, version]);
  const markRef = useRef<HTMLElement>(null);
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center' });
  }, [data, highlight]);
  const [limit, setLimit] = useState(60_000);
  if (!data) return <div className="flex w-[560px] items-center justify-center border-l border-line"><Spinner /></div>;
  const s = data.s;
  if (!s) return null;
  const text = s.text_content;
  // Render only a window of very large documents to keep memory and layout cheap.
  const winStart = highlight ? Math.max(0, highlight.start - limit / 2) : 0;
  const winEnd = Math.min(text.length, winStart + limit);
  const before = text.slice(winStart, highlight ? highlight.start : winEnd);
  const mid = highlight ? text.slice(highlight.start, highlight.end) : '';
  const after = highlight ? text.slice(highlight.end, winEnd) : '';
  const meta = JSON.parse(s.metadata_json || '{}');
  return (
    <aside className="flex w-full flex-col border-l border-line bg-elevated lg:w-[560px]" aria-label={t('src.preview')}>
      <div className="flex items-start gap-3 border-b border-line p-4">
        <span className="text-2xl">{KIND_EMOJI[s.kind]}</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{s.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-faint">
            <StatusBadge s={s} />
            {t('src.chunks', { n: data.chunks })}
            {s.page_count ? ` · ${t('src.pages', { n: s.page_count })}` : ''}
            {s.embedding_model ? ` · ${s.embedding_model}` : ''}
          </div>
          {s.origin.startsWith('http') && <div className="mt-1 truncate text-xs text-accent">{s.origin}</div>}
          {meta.embeddingWarning && <div className="mt-1 text-xs text-warning">{meta.embeddingWarning}</div>}
        </div>
        <IconButton label={t('common.close')} onClick={() => navigate({ name: 'sources' })}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <BookOpen className="size-4 text-muted" />
        <select
          aria-label={t('src.addToNotebook')}
          className="h-8 flex-1 rounded-md border border-line bg-bg px-2 text-sm"
          value=""
          onChange={async (e) => {
            if (!e.target.value) return;
            await repos().notebooks.addSource(e.target.value, s.id);
            useApp.getState().toast(t('src.addToNotebook') + ' ✓', 'success');
            useApp.getState().bump();
          }}
        >
          <option value="">{t('src.addToNotebook')}…</option>
          {data.notebooks.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
      </div>
      {s.status === 'error' && <div className="m-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{s.error}</div>}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{t('src.preview')}</div>
        {text ? (
          <div className="whitespace-pre-wrap font-serif text-[14.5px] leading-relaxed">
            {winStart > 0 && '…'}
            {before}
            {highlight && (
              <mark ref={markRef} className="rounded bg-amber-300/60 px-0.5 dark:bg-amber-500/40">
                {mid}
              </mark>
            )}
            {after}
            {winEnd < text.length && (
              <div className="mt-4">
                <Button size="sm" onClick={() => setLimit((l) => l * 2)}>
                  …
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">—</p>
        )}
      </div>
    </aside>
  );
}
