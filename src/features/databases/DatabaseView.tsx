import { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Calendar as CalendarIcon,
  GanttChart,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Filter,
  GalleryHorizontalEnd,
  Hash,
  Link2,
  List as ListIcon,
  MoreHorizontal,
  Plus,
  Sigma,
  Table as TableIcon,
  Tag,
  Trash2,
  Type,
  X,
  CircleDot,
  Globe,
  Pencil,
  Calculator,
} from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT, type MessageKey } from '../../i18n';
import { Badge, Button, cx, IconButton, Input, MenuButton, Modal, Popover, promptDialog, Select, Spinner, Tabs, useAsync, type MenuItem } from '../../components/ui';
import { applyView, computedValue, displayValue, groupRows, ROLLUP_FNS, rowTitle, type RelatedData } from '../../core/repos/databases';
import type { CellValue, DbProperty, DbRow, DbView, FilterOp, PropertyType, RollupFn, ViewConfig, ViewType } from '../../core/types';
import { reportError } from '../../app/services';
import { openExternal } from '../../lib/platform';

const TYPE_ICON: Record<PropertyType, React.ReactNode> = {
  title: <Type className="size-3.5" />,
  text: <Type className="size-3.5" />,
  number: <Hash className="size-3.5" />,
  date: <CalendarIcon className="size-3.5" />,
  checkbox: <CheckSquare className="size-3.5" />,
  select: <CircleDot className="size-3.5" />,
  multi_select: <Tag className="size-3.5" />,
  url: <Globe className="size-3.5" />,
  relation: <Link2 className="size-3.5" />,
  status: <CircleDot className="size-3.5" />,
  formula: <Sigma className="size-3.5" />,
  rollup: <Calculator className="size-3.5" />,
};
const VIEW_ICON: Record<ViewType, React.ReactNode> = {
  table: <TableIcon className="size-3.5" />,
  board: <Columns3 className="size-3.5" />,
  calendar: <CalendarIcon className="size-3.5" />,
  list: <ListIcon className="size-3.5" />,
  gallery: <GalleryHorizontalEnd className="size-3.5" />,
  timeline: <GanttChart className="size-3.5" />,
};
const OPS: FilterOp[] = ['contains', 'not_contains', 'equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty', 'is_checked', 'is_not_checked'];

interface Ctx {
  props: DbProperty[];
  rows: DbRow[];
  reload: () => void;
  relationTitles: Map<string, Map<string, string>>;
  related: RelatedData;
}

export default function DatabaseView({ databaseId }: { databaseId: string }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const [n, setN] = useState(0);
  const reload = () => setN((x) => x + 1);
  const { data } = useAsync(async () => {
    const r = repos().databases;
    const [props, rows, views] = await Promise.all([r.properties(databaseId), r.rows(databaseId), r.views(databaseId)]);
    const related = await r.relatedData(props);
    const relationTitles = new Map<string, Map<string, string>>();
    for (const p of props) {
      const target = p.type === 'relation' && p.options.relationDatabaseId ? related.get(p.options.relationDatabaseId) : undefined;
      if (target) relationTitles.set(p.id, new Map([...target.rows.values()].map((row) => [row.id, rowTitle(target.props, row)])));
    }
    return { props, rows, views, relationTitles, related };
  }, [databaseId, version, n]);
  const [viewId, setViewId] = useState<string | null>(null);
  if (!data) return <div className="py-10"><Spinner /></div>;
  const view = data.views.find((v) => v.id === viewId) ?? data.views[0];
  const ctx: Ctx = { props: data.props, rows: data.rows, reload, relationTitles: data.relationTitles, related: data.related };
  const rows = applyView(data.rows, data.props, view.config, data.related);
  const addRow = async (values: Record<string, CellValue> = {}) => {
    await repos().databases.addRow(databaseId, values).catch(reportError);
    reload();
  };
  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-line pb-2">
        <Tabs value={view.id} onChange={setViewId} tabs={data.views.map((v) => ({ value: v.id, label: <>{VIEW_ICON[v.type]}{v.name}</> }))} />
        <MenuButton
          label={t('db.addView')}
          items={(['table', 'board', 'calendar', 'timeline', 'list', 'gallery'] as ViewType[]).map((type) => ({
            label: t(`db.view.${type}` as MessageKey),
            icon: VIEW_ICON[type],
            onSelect: async () => {
              const status = data.props.find((p) => p.type === 'status' || p.type === 'select');
              const date = data.props.find((p) => p.type === 'date');
              const v = await repos().databases.addView(databaseId, t(`db.view.${type}` as MessageKey), type, {
                groupBy: type === 'board' ? status?.id : undefined,
                dateProperty: type === 'calendar' || type === 'timeline' ? date?.id : undefined,
              });
              setViewId(v.id);
              reload();
            },
          }))}
        >
          <Plus className="size-4" />
        </MenuButton>
        <span className="flex-1" />
        <ViewToolbar view={view} props={data.props} reload={reload} onDeleted={() => setViewId(null)} />
        <span className="text-xs text-faint">{t('db.rows', { n: rows.length })}</span>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => void addRow()}>
          {t('db.addRow')}
        </Button>
      </div>
      {view.type === 'table' && <TableView ctx={ctx} rows={rows} databaseId={databaseId} config={view.config} />}
      {view.type === 'board' && <BoardView ctx={ctx} rows={rows} view={view} addRow={addRow} />}
      {view.type === 'calendar' && <CalendarView ctx={ctx} rows={rows} view={view} addRow={addRow} />}
      {view.type === 'timeline' && <TimelineView ctx={ctx} rows={rows} view={view} />}
      {view.type === 'list' && <ListView ctx={ctx} rows={rows} />}
      {view.type === 'gallery' && <GalleryView ctx={ctx} rows={rows} />}
    </div>
  );
}

function ViewToolbar({ view, props, reload, onDeleted }: { view: DbView; props: DbProperty[]; reload: () => void; onDeleted: () => void }) {
  const t = useT();
  const [filterEl, setFilterEl] = useState<HTMLElement | null>(null);
  const [sortEl, setSortEl] = useState<HTMLElement | null>(null);
  const cfg = view.config;
  const save = async (config: ViewConfig) => {
    await repos().databases.updateView(view.id, { config });
    reload();
  };
  const groupable = props.filter((p) => ['select', 'status', 'checkbox', 'multi_select', 'text'].includes(p.type));
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant={cfg.filters?.length ? 'subtle' : 'ghost'} icon={<Filter className="size-3.5" />} onClick={(e) => setFilterEl(e.currentTarget)}>
        {t('db.filter')}
        {cfg.filters?.length ? ` · ${cfg.filters.length}` : ''}
      </Button>
      <Button size="sm" variant={cfg.sorts?.length ? 'subtle' : 'ghost'} icon={<ArrowDownUp className="size-3.5" />} onClick={(e) => setSortEl(e.currentTarget)}>
        {t('db.sort')}
        {cfg.sorts?.length ? ` · ${cfg.sorts.length}` : ''}
      </Button>
      {view.type === 'board' && (
        <Select
          ariaLabel={t('db.group')}
          value={cfg.groupBy ?? ''}
          onChange={(v) => void save({ ...cfg, groupBy: v || undefined })}
          className="h-7 text-xs"
          options={[{ value: '', label: `${t('db.group')}…` }, ...groupable.map((p) => ({ value: p.id, label: p.name }))]}
        />
      )}
      {(view.type === 'calendar' || view.type === 'timeline') && (
        <Select
          ariaLabel={view.type === 'timeline' ? t('db.timeline.start') : 'Date property'}
          value={cfg.dateProperty ?? ''}
          onChange={(v) => void save({ ...cfg, dateProperty: v || undefined })}
          className="h-7 text-xs"
          options={[{ value: '', label: '—' }, ...props.filter((p) => p.type === 'date').map((p) => ({ value: p.id, label: p.name }))]}
        />
      )}
      {view.type === 'timeline' && (
        <Select
          ariaLabel={t('db.timeline.end')}
          value={cfg.endDateProperty ?? ''}
          onChange={(v) => void save({ ...cfg, endDateProperty: v || undefined })}
          className="h-7 text-xs"
          options={[{ value: '', label: `${t('db.timeline.end')}: —` }, ...props.filter((p) => p.type === 'date').map((p) => ({ value: p.id, label: `${t('db.timeline.end')}: ${p.name}` }))]}
        />
      )}
      <MenuButton
        label="View options"
        align="end"
        items={[
          {
            label: t('common.rename'),
            icon: <Pencil className="size-3.5" />,
            onSelect: async () => {
              const name = await promptDialog(t('common.rename'), view.name);
              if (name?.trim()) {
                await repos().databases.updateView(view.id, { name: name.trim() });
                reload();
              }
            },
          },
          {
            label: t('common.delete'),
            icon: <Trash2 className="size-3.5" />,
            danger: true,
            onSelect: async () => {
              try {
                await repos().databases.removeView(view.id);
                onDeleted();
                reload();
              } catch (e) {
                reportError(e);
              }
            },
          },
        ]}
      >
        <MoreHorizontal className="size-4" />
      </MenuButton>
      <Popover anchor={filterEl} open={!!filterEl} onClose={() => setFilterEl(null)} align="end">
        <div className="w-[440px] space-y-2 p-2">
          {(cfg.filters ?? []).map((f, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Select
                ariaLabel="Property"
                value={f.propertyId}
                className="h-8 w-32 text-xs"
                onChange={(v) => void save({ ...cfg, filters: cfg.filters!.map((x, j) => (j === i ? { ...x, propertyId: v } : x)) })}
                options={props.map((p) => ({ value: p.id, label: p.name }))}
              />
              <Select
                ariaLabel="Operator"
                value={f.op}
                className="h-8 w-36 text-xs"
                onChange={(v) => void save({ ...cfg, filters: cfg.filters!.map((x, j) => (j === i ? { ...x, op: v } : x)) })}
                options={OPS.map((o) => ({ value: o, label: t(`db.op.${o}` as MessageKey) }))}
              />
              {!['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked'].includes(f.op) && (
                <Input
                  className="h-8 flex-1 text-xs"
                  defaultValue={f.value}
                  onBlur={(e) => void save({ ...cfg, filters: cfg.filters!.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                />
              )}
              <IconButton size="sm" label={t('common.remove')} onClick={() => void save({ ...cfg, filters: cfg.filters!.filter((_, j) => j !== i) })}>
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => void save({ ...cfg, filters: [...(cfg.filters ?? []), { propertyId: props[0].id, op: 'contains', value: '' }] })}>
            {t('db.addFilter')}
          </Button>
        </div>
      </Popover>
      <Popover anchor={sortEl} open={!!sortEl} onClose={() => setSortEl(null)} align="end">
        <div className="w-[340px] space-y-2 p-2">
          {(cfg.sorts ?? []).map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Select
                ariaLabel="Property"
                value={s.propertyId}
                className="h-8 flex-1 text-xs"
                onChange={(v) => void save({ ...cfg, sorts: cfg.sorts!.map((x, j) => (j === i ? { ...x, propertyId: v } : x)) })}
                options={props.map((p) => ({ value: p.id, label: p.name }))}
              />
              <Select
                ariaLabel="Direction"
                value={s.direction}
                className="h-8 text-xs"
                onChange={(v) => void save({ ...cfg, sorts: cfg.sorts!.map((x, j) => (j === i ? { ...x, direction: v } : x)) })}
                options={[
                  { value: 'asc', label: t('db.ascending') },
                  { value: 'desc', label: t('db.descending') },
                ]}
              />
              <IconButton size="sm" label={t('common.remove')} onClick={() => void save({ ...cfg, sorts: cfg.sorts!.filter((_, j) => j !== i) })}>
                <X className="size-3.5" />
              </IconButton>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => void save({ ...cfg, sorts: [...(cfg.sorts ?? []), { propertyId: props[0].id, direction: 'asc' }] })}>
            {t('db.addSort')}
          </Button>
        </div>
      </Popover>
    </div>
  );
}

// ---------------- cells ----------------
function Cell({ prop, row, ctx, compact }: { prop: DbProperty; row: DbRow; ctx: Ctx; compact?: boolean }) {
  const t = useT();
  const value = computedValue(prop, row, ctx.props, ctx.related);
  const [editing, setEditing] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const set = async (v: CellValue) => {
    try {
      await repos().databases.updateCell(row.id, prop.id, v);
      ctx.reload();
    } catch (e) {
      reportError(e);
    }
  };
  const base = cx('flex min-h-8 w-full items-center px-2 text-left text-sm', compact && 'min-h-6 px-0');

  switch (prop.type) {
    case 'checkbox':
      return (
        <div className={base}>
          <input type="checkbox" aria-label={prop.name} checked={value === true} onChange={(e) => void set(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        </div>
      );
    case 'formula':
    case 'rollup':
      return <div className={cx(base, 'text-muted')}>{value === null ? '' : String(value)}</div>;
    case 'select':
    case 'status':
    case 'multi_select': {
      const opts = prop.options.options ?? [];
      const selected = prop.type === 'multi_select' ? (Array.isArray(value) ? value : []) : value ? [String(value)] : [];
      return (
        <>
          <button className={cx(base, 'flex-wrap gap-1')} onClick={(e) => setAnchor(e.currentTarget)}>
            {selected.map((id) => {
              const o = opts.find((x) => x.id === id);
              return o ? <Badge key={id} color={o.color}>{o.name}</Badge> : null;
            })}
          </button>
          <Popover anchor={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            <OptionPicker
              prop={prop}
              selected={selected}
              onPick={async (id) => {
                if (prop.type === 'multi_select') await set(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
                else {
                  await set(selected[0] === id ? null : id);
                  setAnchor(null);
                }
              }}
              onCreate={async (name) => {
                const o = await repos().databases.ensureOption(prop.id, name);
                if (prop.type === 'multi_select') await set([...selected, o.id]);
                else await set(o.id);
              }}
            />
          </Popover>
        </>
      );
    }
    case 'relation': {
      const ids = Array.isArray(value) ? value : [];
      const titles = ctx.relationTitles.get(prop.id) ?? new Map();
      return (
        <>
          <button className={cx(base, 'flex-wrap gap-1')} onClick={(e) => setAnchor(e.currentTarget)}>
            {ids.map((id) => (
              <Badge key={id} color="gray">
                <Link2 className="size-3" />
                {titles.get(id) || t('common.untitled')}
              </Badge>
            ))}
          </button>
          <Popover anchor={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            <div className="max-h-64 w-60 overflow-y-auto">
              {!prop.options.relationDatabaseId && <div className="p-2 text-xs text-muted">{t('db.relationTarget')}?</div>}
              {[...titles.entries()].map(([id, title]) => (
                <button
                  key={id}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-hover"
                  onClick={() => void set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])}
                >
                  <input type="checkbox" readOnly checked={ids.includes(id)} className="accent-[var(--accent)]" />
                  {title || t('common.untitled')}
                </button>
              ))}
            </div>
          </Popover>
        </>
      );
    }
    case 'date':
      return (
        <input
          type="date"
          aria-label={prop.name}
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => void set(e.target.value || null)}
          className={cx(base, 'bg-transparent outline-none')}
        />
      );
    default: {
      if (editing)
        return (
          <input
            autoFocus
            aria-label={prop.name}
            type={prop.type === 'number' ? 'number' : 'text'}
            defaultValue={value === null || value === undefined ? '' : String(value)}
            className={cx(base, 'bg-elevated outline outline-2 outline-accent')}
            onBlur={(e) => {
              setEditing(false);
              const raw = e.target.value;
              void set(prop.type === 'number' ? (raw === '' ? null : Number(raw)) : raw);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        );
      const shown = displayValue(prop, value);
      return (
        <div
          role="button"
          tabIndex={0}
          className={cx(base, 'cursor-text truncate', prop.type === 'title' && 'font-medium', prop.type === 'number' && 'justify-end tabular-nums')}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}
        >
          {prop.type === 'url' && shown ? (
            <a
              className="truncate text-accent underline"
              onClick={(e) => {
                e.stopPropagation();
                void openExternal(shown);
              }}
            >
              {shown}
            </a>
          ) : (
            shown || (prop.type === 'title' ? <span className="text-faint">{t('common.untitled')}</span> : '')
          )}
        </div>
      );
    }
  }
}

function OptionPicker({ prop, selected, onPick, onCreate }: { prop: DbProperty; selected: string[]; onPick: (id: string) => void; onCreate: (name: string) => void }) {
  const [q, setQ] = useState('');
  const opts = (prop.options.options ?? []).filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="w-56">
      <Input
        autoFocus
        className="mb-1 h-8 text-xs"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && q.trim()) {
            if (opts[0] && opts[0].name.toLowerCase() === q.trim().toLowerCase()) onPick(opts[0].id);
            else onCreate(q.trim());
            setQ('');
          }
        }}
      />
      {opts.map((o) => (
        <button key={o.id} onClick={() => onPick(o.id)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-hover">
          <Badge color={o.color}>{o.name}</Badge>
          {selected.includes(o.id) && <span className="ml-auto text-accent">✓</span>}
        </button>
      ))}
      {q.trim() && !opts.some((o) => o.name.toLowerCase() === q.trim().toLowerCase()) && (
        <button onClick={() => (onCreate(q.trim()), setQ(''))} className="w-full rounded px-2 py-1 text-left text-sm text-muted hover:bg-hover">
          + {q.trim()}
        </button>
      )}
    </div>
  );
}

function PropertyHeader({ prop, ctx }: { prop: DbProperty; ctx: Ctx }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const items = (): MenuItem[] => [
    {
      label: t('common.rename'),
      icon: <Pencil className="size-3.5" />,
      onSelect: async () => {
        const name = await promptDialog(t('common.rename'), prop.name);
        if (name?.trim()) {
          await repos().databases.updateProperty(prop.id, { name });
          ctx.reload();
        }
      },
    },
    ...(prop.type === 'formula'
      ? [
          {
            label: 'Formula…',
            icon: <Sigma className="size-3.5" />,
            onSelect: () => setOpen(true),
          },
        ]
      : []),
    ...(prop.type === 'rollup'
      ? [
          {
            label: t('db.rollup.configure'),
            icon: <Calculator className="size-3.5" />,
            onSelect: () => setOpen(true),
          },
        ]
      : []),
    ...(prop.type === 'title'
      ? []
      : [
          {
            label: t('db.deleteProperty'),
            icon: <Trash2 className="size-3.5" />,
            danger: true,
            onSelect: async () => {
              await repos().databases.removeProperty(prop.id).catch(reportError);
              ctx.reload();
            },
          },
        ]),
  ];
  return (
    <div className="flex items-center gap-1.5 px-2 text-xs font-medium text-muted">
      <span className="text-faint">{TYPE_ICON[prop.type]}</span>
      <span className="flex-1 truncate">{prop.name}</span>
      <MenuButton items={items} label={`${prop.name} options`} className="size-5 opacity-0 group-hover/th:opacity-100">
        <MoreHorizontal className="size-3.5" />
      </MenuButton>
      {prop.type === 'rollup' ? (
        <RollupDialog prop={prop} props={ctx.props} open={open} onClose={() => setOpen(false)} reload={ctx.reload} />
      ) : (
        <FormulaDialog prop={prop} open={open} onClose={() => setOpen(false)} reload={ctx.reload} />
      )}
    </div>
  );
}

function FormulaDialog({ prop, open, onClose, reload }: { prop: DbProperty; open: boolean; onClose: () => void; reload: () => void }) {
  const t = useT();
  const [expr, setExpr] = useState(prop.options.expression ?? '');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${prop.name} · ${t('db.type.formula')}`}
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            await repos().databases.updateProperty(prop.id, { options: { ...prop.options, expression: expr } });
            reload();
            onClose();
          }}
        >
          {t('common.save')}
        </Button>
      }
    >
      <Input className="font-mono" value={expr} onChange={(e) => setExpr(e.target.value)} autoFocus />
      <p className="mt-2 text-xs text-muted">{t('db.formulaHint')}</p>
    </Modal>
  );
}

function RollupDialog({ prop, props, open, onClose, reload }: { prop: DbProperty; props: DbProperty[]; open: boolean; onClose: () => void; reload: () => void }) {
  const t = useT();
  const relations = props.filter((p) => p.type === 'relation' && p.options.relationDatabaseId);
  const [relId, setRelId] = useState(prop.options.rollup?.relationPropertyId ?? relations[0]?.id ?? '');
  const [targetId, setTargetId] = useState(prop.options.rollup?.targetPropertyId ?? '');
  const [fn, setFn] = useState<RollupFn>(prop.options.rollup?.fn ?? 'count');
  const targetDb = relations.find((p) => p.id === relId)?.options.relationDatabaseId;
  const { data: targetProps } = useAsync(async () => (open && targetDb ? repos().databases.properties(targetDb) : []), [open, targetDb]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${prop.name} · ${t('db.type.rollup')}`}
      footer={
        <Button
          variant="primary"
          disabled={!relId}
          onClick={async () => {
            await repos().databases.updateProperty(prop.id, { options: { ...prop.options, rollup: { relationPropertyId: relId, targetPropertyId: targetId || null, fn } } });
            reload();
            onClose();
          }}
        >
          {t('common.save')}
        </Button>
      }
    >
      {relations.length === 0 ? (
        <p className="text-sm text-muted">{t('db.rollup.noRelation')}</p>
      ) : (
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1">
            {t('db.rollup.relation')}
            <Select ariaLabel={t('db.rollup.relation')} value={relId} onChange={(v) => (setRelId(v), setTargetId(''))} options={relations.map((p) => ({ value: p.id, label: p.name }))} />
          </label>
          <label className="grid gap-1">
            {t('db.rollup.property')}
            <Select
              ariaLabel={t('db.rollup.property')}
              value={targetId}
              onChange={setTargetId}
              options={[{ value: '', label: '—' }, ...(targetProps ?? []).filter((p) => p.type !== 'rollup').map((p) => ({ value: p.id, label: p.name }))]}
            />
          </label>
          <label className="grid gap-1">
            {t('db.rollup.fn')}
            <Select ariaLabel={t('db.rollup.fn')} value={fn} onChange={(v) => setFn(v as RollupFn)} options={ROLLUP_FNS.map((f) => ({ value: f, label: t(`db.rollup.fn.${f}` as MessageKey) }))} />
          </label>
        </div>
      )}
    </Modal>
  );
}

function AddPropertyButton({ databaseId, reload }: { databaseId: string; reload: () => void }) {
  const t = useT();
  const types: PropertyType[] = ['text', 'number', 'date', 'checkbox', 'select', 'multi_select', 'status', 'url', 'relation', 'rollup', 'formula'];
  const [relOpen, setRelOpen] = useState(false);
  const [twoWay, setTwoWay] = useState(true);
  const [rollup, setRollup] = useState<{ prop: DbProperty; props: DbProperty[] } | null>(null);
  const { data: dbs } = useAsync(async () => (relOpen ? repos().databases.listDatabases(wsId()) : []), [relOpen]);
  return (
    <>
      <MenuButton
        label={t('db.addProperty')}
        className="h-8 w-full justify-start px-2"
        items={types.map((type) => ({
          label: t(`db.type.${type}` as MessageKey),
          icon: TYPE_ICON[type],
          onSelect: async () => {
            if (type === 'relation') return setRelOpen(true);
            const prop = await repos().databases.addProperty(databaseId, t(`db.type.${type}` as MessageKey), type);
            reload();
            if (type === 'rollup') setRollup({ prop, props: await repos().databases.properties(databaseId) });
          },
        }))}
      >
        <Plus className="size-4" />
      </MenuButton>
      {rollup && <RollupDialog prop={rollup.prop} props={rollup.props} open onClose={() => setRollup(null)} reload={reload} />}
      <Modal open={relOpen} onClose={() => setRelOpen(false)} title={t('db.relationTarget')}>
        <label className="mb-2 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={twoWay} onChange={(e) => setTwoWay(e.target.checked)} className="accent-[var(--accent)]" />
          {t('db.twoWay')}
        </label>
        {dbs?.map((d) => (
          <button
            key={d.id}
            className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-hover"
            onClick={async () => {
              const self = await repos().pages.get(databaseId);
              await repos().databases.addRelation(databaseId, d.id, d.title || t('db.type.relation'), twoWay ? self?.title || t('db.type.relation') : null);
              setRelOpen(false);
              reload();
            }}
          >
            {d.icon ?? '🗂️'} {d.title || t('common.untitled')}
          </button>
        ))}
      </Modal>
    </>
  );
}

function RowMenu({ row, ctx }: { row: DbRow; ctx: Ctx }) {
  const t = useT();
  return (
    <MenuButton
      label="Row actions"
      className="size-6 opacity-0 group-hover/row:opacity-100"
      items={[
        {
          label: t('db.deleteRow'),
          icon: <Trash2 className="size-3.5" />,
          danger: true,
          onSelect: async () => {
            await repos().databases.deleteRow(row.id);
            ctx.reload();
          },
        },
      ]}
    >
      <MoreHorizontal className="size-3.5" />
    </MenuButton>
  );
}

function TableView({ ctx, rows, databaseId, config }: { ctx: Ctx; rows: DbRow[]; databaseId: string; config: ViewConfig }) {
  const visible = ctx.props.filter((p) => !config.hiddenProperties?.includes(p.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const canReorder = !config.sorts?.length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" role="grid">
        <thead>
          <tr className="border-b border-line">
            <th className="w-6" />
            {visible.map((p) => (
              <th key={p.id} className="group/th min-w-[150px] border-r border-line py-1.5 text-left font-normal last:border-r-0">
                <PropertyHeader prop={p} ctx={ctx} />
              </th>
            ))}
            <th className="w-40">
              <AddPropertyButton databaseId={databaseId} reload={ctx.reload} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={cx('group/row border-b border-line hover:bg-hover/50', dragId === r.id && 'opacity-40')}
              draggable={canReorder}
              onDragStart={() => setDragId(r.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => canReorder && dragId && e.preventDefault()}
              onDrop={async () => {
                if (!dragId || dragId === r.id) return;
                await repos().databases.moveRow(dragId, r.sort_order - 0.5);
                setDragId(null);
                ctx.reload();
              }}
            >
              <td className="w-6 align-middle">
                <RowMenu row={r} ctx={ctx} />
              </td>
              {visible.map((p) => (
                <td key={p.id} className="border-r border-line p-0 last:border-r-0">
                  <Cell prop={p} row={r} ctx={ctx} />
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function titleOf(row: DbRow, props: DbProperty[]) {
  const tp = props.find((p) => p.type === 'title');
  return tp ? String(row.values[tp.id] ?? '') : '';
}

function BoardView({ ctx, rows, view, addRow }: { ctx: Ctx; rows: DbRow[]; view: DbView; addRow: (v?: Record<string, CellValue>) => void }) {
  const t = useT();
  const groupProp = ctx.props.find((p) => p.id === view.config.groupBy);
  const groups = groupRows(rows, groupProp);
  const [overKey, setOverKey] = useState<string | null>(null);
  if (!groupProp) return <p className="py-8 text-center text-sm text-muted">{t('db.group')}…</p>;
  const shown = ctx.props.filter((p) => p.type !== 'title' && p.id !== groupProp.id).slice(0, 3);
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {groups.map((g) => (
        <div
          key={g.key}
          className={cx('w-72 shrink-0 rounded-xl bg-inset p-2', overKey === g.key && 'ring-2 ring-accent')}
          onDragOver={(e) => {
            e.preventDefault();
            setOverKey(g.key);
          }}
          onDragLeave={() => setOverKey(null)}
          onDrop={async (e) => {
            setOverKey(null);
            const id = e.dataTransfer.getData('text/x-noesis-row');
            if (!id) return;
            const v: CellValue = groupProp.type === 'checkbox' ? g.key === 'true' : g.key || null;
            await repos().databases.updateCell(id, groupProp.id, v);
            ctx.reload();
          }}
        >
          <div className="mb-2 flex items-center gap-2 px-1">
            <Badge color={g.color}>{g.label}</Badge>
            <span className="text-xs text-faint">{g.rows.length}</span>
          </div>
          <div className="space-y-2">
            {g.rows.map((r) => (
              <div
                key={r.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/x-noesis-row', r.id)}
                className="group/row cursor-grab rounded-lg border border-line bg-elevated p-2 shadow-sm active:cursor-grabbing"
              >
                <div className="flex items-start">
                  <div className="flex-1">
                    <Cell prop={ctx.props.find((p) => p.type === 'title')!} row={r} ctx={ctx} compact />
                  </div>
                  <RowMenu row={r} ctx={ctx} />
                </div>
                {shown.map((p) => (
                  <div key={p.id} className="text-xs text-muted">
                    <Cell prop={p} row={r} ctx={ctx} compact />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button
            className="mt-2 flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs text-faint hover:bg-hover"
            onClick={() => addRow({ [groupProp.id]: groupProp.type === 'checkbox' ? g.key === 'true' : g.key || null })}
          >
            <Plus className="size-3.5" /> {t('db.addRow')}
          </button>
        </div>
      ))}
    </div>
  );
}

function CalendarView({ ctx, rows, view, addRow }: { ctx: Ctx; rows: DbRow[]; view: DbView; addRow: (v?: Record<string, CellValue>) => void }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const dateProp = ctx.props.find((p) => p.id === view.config.dateProperty) ?? ctx.props.find((p) => p.type === 'date');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const days = useMemo(() => {
    const start = new Date(month);
    const offset = (start.getDay() + 6) % 7; // Monday first
    start.setDate(start.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);
  if (!dateProp) return <p className="py-8 text-center text-sm text-muted">{t('db.noDate')}</p>;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const byDay = new Map<string, DbRow[]>();
  for (const r of rows) {
    const v = r.values[dateProp.id];
    if (typeof v === 'string' && v) byDay.set(v.slice(0, 10), [...(byDay.get(v.slice(0, 10)) ?? []), r]);
  }
  const today = iso(new Date());
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <IconButton label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <div className="w-40 text-center text-sm font-semibold">{month.toLocaleDateString(lang, { month: 'long', year: 'numeric' })}</div>
        <IconButton label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight className="size-4" />
        </IconButton>
        <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
          {t('common.today')}
        </Button>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-line text-xs">
        {days.slice(0, 7).map((d) => (
          <div key={d.toString()} className="border-b border-line bg-inset px-2 py-1 text-faint">
            {d.toLocaleDateString(lang, { weekday: 'short' })}
          </div>
        ))}
        {days.map((d) => {
          const key = iso(d);
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={key}
              className={cx('group/day min-h-24 border-b border-r border-line p-1 [&:nth-child(7n)]:border-r-0', !inMonth && 'bg-inset/50 text-faint')}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                const id = e.dataTransfer.getData('text/x-noesis-row');
                if (!id) return;
                await repos().databases.updateCell(id, dateProp.id, key);
                ctx.reload();
              }}
            >
              <div className="flex items-center justify-between">
                <span className={cx('flex size-5 items-center justify-center rounded-full', key === today && 'bg-accent text-white')}>{d.getDate()}</span>
                <button className="opacity-0 group-hover/day:opacity-100" aria-label="Add" onClick={() => addRow({ [dateProp.id]: key })}>
                  <Plus className="size-3" />
                </button>
              </div>
              {(byDay.get(key) ?? []).map((r) => (
                <div key={r.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/x-noesis-row', r.id)} className="mt-0.5 truncate rounded bg-accent-soft px-1 py-0.5 text-accent">
                  {titleOf(r, ctx.props) || t('common.untitled')}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDay = (v: CellValue) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00`) : null);

/** Gantt-style timeline: bars from the start date to the (optional) end date; drag to move, drag the right edge to resize. */
function TimelineView({ ctx, rows, view }: { ctx: Ctx; rows: DbRow[]; view: DbView }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const startProp = ctx.props.find((p) => p.id === view.config.dateProperty) ?? ctx.props.find((p) => p.type === 'date');
  const endProp = ctx.props.find((p) => p.id === view.config.endDateProperty && p.type === 'date');
  const DAYS = 42;
  const COL = 30;
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); // Monday of last week
    return d;
  });
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'end'; x0: number; dx: number } | null>(null);
  if (!startProp) return <p className="py-8 text-center text-sm text-muted">{t('db.noDate')}</p>;
  const days = Array.from({ length: DAYS }, (_, i) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + i));
  const today = isoDay(new Date());
  const dated = rows.filter((r) => parseDay(r.values[startProp.id]));
  const undated = rows.length - dated.length;
  const shiftDays = (dx: number) => Math.round(dx / COL);
  const commit = async (r: DbRow, mode: 'move' | 'end', delta: number) => {
    if (!delta) return;
    const s = parseDay(r.values[startProp.id])!;
    const e = endProp ? parseDay(r.values[endProp.id]) : null;
    const add = (d: Date, n: number) => isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
    if (mode === 'move') {
      await repos().databases.updateCell(r.id, startProp.id, add(s, delta));
      if (endProp && e) await repos().databases.updateCell(r.id, endProp.id, add(e, delta));
    } else if (endProp) {
      const end = new Date(Math.max(s.getTime(), (e ?? s).getTime() + delta * DAY_MS));
      await repos().databases.updateCell(r.id, endProp.id, isoDay(end));
    }
    ctx.reload();
  };
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <IconButton label="Previous" onClick={() => setFrom(new Date(from.getFullYear(), from.getMonth(), from.getDate() - 28))}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <div className="min-w-48 text-center text-sm font-semibold">
          {days[0].toLocaleDateString(lang, { day: 'numeric', month: 'short' })} – {days[DAYS - 1].toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
        <IconButton label="Next" onClick={() => setFrom(new Date(from.getFullYear(), from.getMonth(), from.getDate() + 28))}>
          <ChevronRight className="size-4" />
        </IconButton>
        {undated > 0 && <span className="ml-auto text-xs text-faint">{t('db.timeline.undated', { n: undated })}</span>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line" role="grid" aria-label={t('db.view.timeline')}>
        <div style={{ width: 200 + DAYS * COL }}>
          <div className="flex border-b border-line bg-inset text-[10px] text-faint">
            <div className="w-[200px] shrink-0 px-2 py-1">{startProp.name}</div>
            {days.map((d) => (
              <div key={d.toString()} style={{ width: COL }} className={cx('shrink-0 py-1 text-center', isoDay(d) === today && 'font-semibold text-accent', d.getDay() === 1 && 'border-l border-line')}>
                {d.getDay() === 1 || d.getDate() === 1 ? d.toLocaleDateString(lang, { day: 'numeric', month: 'short' }) : d.getDate()}
              </div>
            ))}
          </div>
          {dated.map((r) => {
            const s = parseDay(r.values[startProp.id])!;
            const e = (endProp && parseDay(r.values[endProp.id])) || s;
            const delta = drag?.id === r.id ? shiftDays(drag.dx) : 0;
            const startIdx = Math.round((s.getTime() - from.getTime()) / DAY_MS) + (drag?.id === r.id && drag.mode === 'move' ? delta : 0);
            const span = Math.max(1, Math.round((Math.max(e.getTime(), s.getTime()) - s.getTime()) / DAY_MS) + 1 + (drag?.id === r.id && drag.mode === 'end' ? delta : 0));
            const visible = startIdx + span > 0 && startIdx < DAYS;
            return (
              <div key={r.id} role="row" className="relative flex h-9 items-center border-b border-line last:border-b-0">
                <div className="w-[200px] shrink-0 truncate px-2 text-sm">{titleOf(r, ctx.props) || t('common.untitled')}</div>
                <div className="relative h-full flex-1">
                  {days.map((d, i) => isoDay(d) === today && <div key={i} className="absolute inset-y-0 w-px bg-accent/40" style={{ left: i * COL + COL / 2 }} />)}
                  {visible && (
                    <div
                      role="gridcell"
                      aria-label={`${titleOf(r, ctx.props)}: ${isoDay(s)} – ${isoDay(e)}`}
                      className={cx('absolute top-1.5 flex h-6 cursor-grab items-center overflow-hidden rounded-md bg-accent px-2 text-xs text-white shadow-sm', drag?.id === r.id && 'cursor-grabbing opacity-90')}
                      style={{ left: Math.max(0, startIdx) * COL + 2, width: Math.max(COL - 4, (Math.min(DAYS, startIdx + span) - Math.max(0, startIdx)) * COL - 4) }}
                      onPointerDown={(ev) => {
                        (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
                        setDrag({ id: r.id, mode: (ev.target as HTMLElement).dataset.handle === 'end' ? 'end' : 'move', x0: ev.clientX, dx: 0 });
                      }}
                      onPointerMove={(ev) => drag?.id === r.id && setDrag({ ...drag, dx: ev.clientX - drag.x0 })}
                      onPointerUp={() => {
                        if (drag?.id !== r.id) return;
                        const d = drag;
                        setDrag(null);
                        void commit(r, d.mode, shiftDays(d.dx)).catch(reportError);
                      }}
                    >
                      <span className="truncate">{titleOf(r, ctx.props)}</span>
                      {endProp && <span data-handle="end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/30" />}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!dated.length && <p className="py-6 text-center text-sm text-muted">{t('db.timeline.empty')}</p>}
        </div>
      </div>
    </div>
  );
}

function ListView({ ctx, rows }: { ctx: Ctx; rows: DbRow[] }) {
  const titleProp = ctx.props.find((p) => p.type === 'title')!;
  const others = ctx.props.filter((p) => p.type !== 'title').slice(0, 4);
  return (
    <div className="divide-y divide-line rounded-lg border border-line">
      {rows.map((r) => (
        <div key={r.id} className="group/row flex items-center gap-3 px-2 py-1">
          <div className="min-w-0 flex-1">
            <Cell prop={titleProp} row={r} ctx={ctx} />
          </div>
          {others.map((p) => (
            <div key={p.id} className="w-32 text-xs text-muted">
              <Cell prop={p} row={r} ctx={ctx} compact />
            </div>
          ))}
          <RowMenu row={r} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}

function GalleryView({ ctx, rows }: { ctx: Ctx; rows: DbRow[] }) {
  const titleProp = ctx.props.find((p) => p.type === 'title')!;
  const others = ctx.props.filter((p) => p.type !== 'title').slice(0, 4);
  const colors = ['#c7d2fe', '#fbcfe8', '#bbf7d0', '#fde68a', '#bae6fd', '#ddd6fe'];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r, i) => (
        <div key={r.id} className="group/row overflow-hidden rounded-xl border border-line bg-elevated shadow-sm">
          <div className="h-20" style={{ background: `linear-gradient(135deg, ${colors[i % colors.length]}, transparent)` }} />
          <div className="p-3">
            <div className="flex items-center">
              <div className="flex-1">
                <Cell prop={titleProp} row={r} ctx={ctx} compact />
              </div>
              <RowMenu row={r} ctx={ctx} />
            </div>
            {others.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs text-muted">
                <span className="w-20 shrink-0 truncate text-faint">{p.name}</span>
                <Cell prop={p} row={r} ctx={ctx} compact />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
