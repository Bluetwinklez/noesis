import { useMemo, useState } from 'react';
import { Bell, CalendarDays, CheckSquare, ChevronDown, ChevronRight, Flag, Plus, Repeat, Trash2, X, FileText } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT, type MessageKey } from '../../i18n';
import { Badge, Button, confirmDialog, cx, EmptyState, IconButton, Input, Modal, PageHeader, Select, Switch, Tabs, Textarea, useAsync } from '../../components/ui';
import type { Recurrence, Task, TaskStatus } from '../../core/types';
import { reportError } from '../../app/services';

const PRIORITY_COLOR = ['gray', 'blue', 'amber', 'red'];
const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done', 'cancelled'];

function toLocalInput(ts: number | null) {
  if (!ts) return '';
  const d = new Date(ts);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function fromLocalInput(v: string) {
  return v ? new Date(v).getTime() : null;
}

export default function TasksPage() {
  const t = useT();
  const version = useApp((s) => s.version);
  const bump = useApp((s) => s.bump);
  const [view, setView] = useState<'list' | 'board' | 'upcoming'>('list');
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const { data: tasks } = useAsync(() => repos().tasks.list(wsId()), [version]);
  const { data: pages } = useAsync(() => repos().pages.listTree(wsId()), [version]);
  const pageTitle = useMemo(() => new Map((pages ?? []).map((p) => [p.id, `${p.icon ?? '📄'} ${p.title || t('common.untitled')}`])), [pages, t]);

  const add = async () => {
    if (!title.trim()) return;
    // Lightweight natural shortcuts: "!3" priority, "today"/"bugün", "tomorrow"/"yarın".
    let text = title.trim();
    let priority = 2;
    const pm = text.match(/\s!([0-3])\b/);
    if (pm) {
      priority = Number(pm[1]);
      text = text.replace(pm[0], '');
    }
    let due: number | null = null;
    const day = (n: number) => {
      const d = new Date();
      d.setHours(17, 0, 0, 0);
      d.setDate(d.getDate() + n);
      return d.getTime();
    };
    if (/\b(today|bugün)\b/i.test(text)) (due = day(0)), (text = text.replace(/\b(today|bugün)\b/i, ''));
    else if (/\b(tomorrow|yarın)\b/i.test(text)) (due = day(1)), (text = text.replace(/\b(tomorrow|yarın)\b/i, ''));
    try {
      await repos().tasks.create({ workspaceId: wsId(), title: text.trim(), priority, dueAt: due });
      setTitle('');
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  const toggle = async (task: Task) => {
    try {
      if (task.status === 'done') await repos().tasks.reopen(task.id);
      else {
        const next = await repos().tasks.complete(task.id);
        if (next) useApp.getState().toast(`${t('task.recurrence')}: ${new Date(next.due_at!).toLocaleDateString()}`, 'success');
      }
      bump();
    } catch (e) {
      reportError(e);
    }
  };

  const roots = (tasks ?? []).filter((x) => !x.parent_id);
  const childrenOf = (id: string) => (tasks ?? []).filter((x) => x.parent_id === id);
  const visible = roots.filter((x) => showDone || (x.status !== 'done' && x.status !== 'cancelled'));

  const Row = ({ task, depth = 0 }: { task: Task; depth?: number }) => {
    const [open, setOpen] = useState(true);
    const subs = childrenOf(task.id).filter((x) => showDone || x.status !== 'done');
    const overdue = task.due_at && task.due_at < Date.now() && task.status !== 'done';
    return (
      <>
        <div className={cx('group flex items-center gap-2 border-t border-line px-3 py-2 first:border-t-0 hover:bg-hover/60')} style={{ paddingLeft: 12 + depth * 24 }}>
          {subs.length ? (
            <button aria-label="Toggle subtasks" onClick={() => setOpen(!open)} className="text-faint">
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <span className="w-3.5" />
          )}
          <input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.status === 'done'} onChange={() => void toggle(task)} className="size-4 accent-[var(--accent)]" />
          <button onClick={() => setEditing(task)} className={cx('min-w-0 flex-1 truncate text-left text-sm', task.status === 'done' && 'text-faint line-through')}>
            {task.title}
          </button>
          {task.recurrence && <Repeat className="size-3.5 text-faint" />}
          {task.remind_at && <Bell className="size-3.5 text-faint" />}
          {task.project_page_id && pageTitle.get(task.project_page_id) && (
            <button className="hidden max-w-40 truncate text-xs text-muted hover:underline md:block" onClick={() => useApp.getState().navigate({ name: 'page', id: task.project_page_id! })}>
              {pageTitle.get(task.project_page_id)}
            </button>
          )}
          {task.due_at && <span className={cx('text-xs', overdue ? 'font-medium text-danger' : 'text-muted')}>{new Date(task.due_at).toLocaleDateString()}</span>}
          <Badge color={PRIORITY_COLOR[task.priority]}>
            <Flag className="size-3" />
            {t(`task.priority.${task.priority}` as MessageKey)}
          </Badge>
        </div>
        {open && subs.map((s) => <Row key={s.id} task={s} depth={depth + 1} />)}
      </>
    );
  };

  const upcoming = useMemo(() => {
    const groups: { key: string; label: string; items: Task[] }[] = [];
    const open = (tasks ?? []).filter((x) => x.status !== 'done' && x.status !== 'cancelled');
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const overdue = open.filter((x) => x.due_at && x.due_at < startOfDay);
    if (overdue.length) groups.push({ key: 'overdue', label: t('task.overdue'), items: overdue });
    for (let i = 0; i < 7; i++) {
      const s = startOfDay + i * 86400000;
      const items = open.filter((x) => x.due_at && x.due_at >= s && x.due_at < s + 86400000);
      groups.push({ key: String(s), label: i === 0 ? t('common.today') : new Date(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }), items });
    }
    const later = open.filter((x) => x.due_at && x.due_at >= startOfDay + 7 * 86400000);
    if (later.length) groups.push({ key: 'later', label: '…', items: later });
    const nodate = open.filter((x) => !x.due_at && !x.parent_id);
    if (nodate.length) groups.push({ key: 'nodate', label: t('task.noDate'), items: nodate });
    return groups;
  }, [tasks, t]);

  return (
    <div className="mx-auto max-w-[980px] px-8 py-10">
      <PageHeader
        icon={<CheckSquare className="size-5" />}
        title={t('task.title')}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted">
              <Switch checked={showDone} onChange={setShowDone} label={t('task.showDone')} />
              {t('task.showDone')}
            </label>
            <Tabs
              value={view}
              onChange={setView}
              tabs={[
                { value: 'list', label: t('task.view.list') },
                { value: 'board', label: t('task.view.board') },
                { value: 'upcoming', label: t('task.view.upcoming') },
              ]}
            />
          </>
        }
      />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('task.placeholder')} aria-label={t('task.new')} />
        <Button variant="primary" type="submit" icon={<Plus className="size-4" />}>
          {t('common.add')}
        </Button>
      </form>
      {tasks?.length === 0 && <EmptyState icon={<CheckSquare className="size-5" />} title={t('task.empty')} />}
      {view === 'list' && visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line bg-elevated">
          {visible
            .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || b.priority - a.priority || (a.due_at ?? Infinity) - (b.due_at ?? Infinity))
            .map((task) => (
              <Row key={task.id} task={task} />
            ))}
        </div>
      )}
      {view === 'board' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {STATUSES.filter((s) => showDone || s !== 'cancelled').map((s) => (
            <div
              key={s}
              className="min-h-40 rounded-xl bg-inset p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                const id = e.dataTransfer.getData('text/x-noesis-task');
                if (!id) return;
                if (s === 'done') await repos().tasks.complete(id);
                else await repos().tasks.update(id, { status: s, completed_at: null });
                bump();
              }}
            >
              <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-faint">
                {t(`task.status.${s}` as MessageKey)} · {(tasks ?? []).filter((x) => x.status === s).length}
              </div>
              {(tasks ?? [])
                .filter((x) => x.status === s)
                .map((task) => (
                  <button
                    key={task.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/x-noesis-task', task.id)}
                    onClick={() => setEditing(task)}
                    className="mb-2 block w-full rounded-lg border border-line bg-elevated p-2 text-left text-sm shadow-sm"
                  >
                    <div className="mb-1">{task.title}</div>
                    <div className="flex gap-1">
                      <Badge color={PRIORITY_COLOR[task.priority]}>{t(`task.priority.${task.priority}` as MessageKey)}</Badge>
                      {task.due_at && <Badge>{new Date(task.due_at).toLocaleDateString()}</Badge>}
                    </div>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
      {view === 'upcoming' && (
        <div className="space-y-4">
          {upcoming.map((g) => (
            <section key={g.key}>
              <h2 className={cx('mb-1 flex items-center gap-2 text-sm font-semibold', g.key === 'overdue' && 'text-danger')}>
                <CalendarDays className="size-4" /> {g.label} <span className="text-xs font-normal text-faint">{g.items.length}</span>
              </h2>
              {g.items.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-line bg-elevated">
                  {g.items.map((task) => (
                    <Row key={task.id} task={task} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {editing && <TaskDialog task={editing} allTasks={tasks ?? []} onClose={() => setEditing(null)} pages={pages ?? []} />}
    </div>
  );
}

function TaskDialog({ task, onClose, pages, allTasks }: { task: Task; onClose: () => void; pages: { id: string; title: string; icon: string | null }[]; allTasks: Task[] }) {
  const t = useT();
  const bump = useApp((s) => s.bump);
  const [draft, setDraft] = useState(task);
  const [sub, setSub] = useState('');
  const subs = allTasks.filter((x) => x.parent_id === task.id);
  const save = async () => {
    try {
      await repos().tasks.update(task.id, {
        title: draft.title,
        notes: draft.notes,
        status: draft.status,
        priority: draft.priority,
        due_at: draft.due_at,
        remind_at: draft.remind_at,
        recurrence: draft.recurrence,
        project_page_id: draft.project_page_id,
        completed_at: draft.status === 'done' ? task.completed_at ?? Date.now() : null,
      });
      bump();
      onClose();
    } catch (e) {
      reportError(e);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('task.title')}
      width={560}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={async () => {
              if (!(await confirmDialog(t('common.delete'), task.title, { danger: true }))) return;
              await repos().tasks.remove(task.id);
              bump();
              onClose();
            }}
          >
            {t('common.delete')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Title" className="text-base font-medium" />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-xs text-muted">Status</span>
            <Select value={draft.status} onChange={(v) => setDraft({ ...draft, status: v })} className="w-full" options={STATUSES.map((s) => ({ value: s, label: t(`task.status.${s}` as MessageKey) }))} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted">{t('task.priority')}</span>
            <Select value={String(draft.priority)} onChange={(v) => setDraft({ ...draft, priority: Number(v) })} className="w-full" options={[0, 1, 2, 3].map((p) => ({ value: String(p), label: t(`task.priority.${p}` as MessageKey) }))} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted">{t('task.due')}</span>
            <Input type="datetime-local" value={toLocalInput(draft.due_at)} onChange={(e) => setDraft({ ...draft, due_at: fromLocalInput(e.target.value) })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted">{t('task.reminder')}</span>
            <Input type="datetime-local" value={toLocalInput(draft.remind_at)} onChange={(e) => setDraft({ ...draft, remind_at: fromLocalInput(e.target.value) })} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted">{t('task.recurrence')}</span>
            <Select
              value={draft.recurrence ?? ''}
              onChange={(v) => setDraft({ ...draft, recurrence: (v || null) as Recurrence | null })}
              className="w-full"
              options={[
                { value: '', label: t('task.recurrence.none') },
                ...(['daily', 'weekly', 'monthly', 'yearly'] as const).map((r) => ({ value: r, label: t(`task.recurrence.${r}`) })),
              ]}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted">{t('task.project')}</span>
            <Select
              value={draft.project_page_id ?? ''}
              onChange={(v) => setDraft({ ...draft, project_page_id: v || null })}
              className="w-full"
              options={[{ value: '', label: '—' }, ...pages.map((p) => ({ value: p.id, label: `${p.icon ?? '📄'} ${p.title || t('common.untitled')}` }))]}
            />
          </label>
        </div>
        <Textarea rows={3} placeholder={t('task.notes')} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        {task.source_page_id && (
          <button className="flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => (onClose(), useApp.getState().navigate({ name: 'page', id: task.source_page_id! }))}>
            <FileText className="size-3" /> source page
          </button>
        )}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{t('task.subtasks')}</div>
          {subs.map((s) => (
            <div key={s.id} className="flex items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={s.status === 'done'}
                className="accent-[var(--accent)]"
                onChange={async () => {
                  if (s.status === 'done') await repos().tasks.reopen(s.id);
                  else await repos().tasks.complete(s.id);
                  bump();
                }}
              />
              <span className={cx('flex-1', s.status === 'done' && 'text-faint line-through')}>{s.title}</span>
              <IconButton
                size="sm"
                label={t('common.remove')}
                onClick={async () => {
                  await repos().tasks.remove(s.id);
                  bump();
                }}
              >
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
          <form
            className="mt-1 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!sub.trim()) return;
              await repos().tasks.create({ workspaceId: wsId(), title: sub, parentId: task.id, projectPageId: task.project_page_id });
              setSub('');
              bump();
            }}
          >
            <Input className="h-8 text-sm" placeholder={t('task.addSubtask')} value={sub} onChange={(e) => setSub(e.target.value)} />
          </form>
        </div>
      </div>
    </Modal>
  );
}
