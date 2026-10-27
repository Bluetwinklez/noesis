import type { Database } from '../db/driver';
import type {
  CellValue,
  DbProperty,
  DbRow,
  DbView,
  PropertyOptions,
  PropertyType,
  SelectOption,
  ViewConfig,
  ViewType,
} from '../types';
import { now, parseJson, uid } from '../../lib/util';
import { indexRemove, indexUpsert } from './search-index';
import { evaluateFormula } from '../formula';
import { PageRepo } from './pages';

interface RawProp {
  id: string;
  database_id: string;
  name: string;
  type: PropertyType;
  options_json: string;
  sort_order: number;
}
interface RawRow {
  id: string;
  database_id: string;
  values_json: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}
interface RawView {
  id: string;
  database_id: string;
  name: string;
  type: ViewType;
  config_json: string;
  sort_order: number;
}

const toProp = (r: RawProp): DbProperty => ({ ...r, options: parseJson<PropertyOptions>(r.options_json, {}) });
const toRow = (r: RawRow): DbRow => ({ ...r, values: parseJson<Record<string, CellValue>>(r.values_json, {}) });
const toView = (r: RawView): DbView => ({ ...r, config: parseJson<ViewConfig>(r.config_json, {}) });

const COLORS = ['gray', 'blue', 'green', 'amber', 'red', 'violet', 'pink', 'teal'];
export const defaultStatusOptions = (): SelectOption[] => [
  { id: 'not_started', name: 'Not started', color: 'gray' },
  { id: 'in_progress', name: 'In progress', color: 'blue' },
  { id: 'done', name: 'Done', color: 'green' },
];

export class DatabaseRepo {
  private pages: PageRepo;
  constructor(private db: Database) {
    this.pages = new PageRepo(db);
  }

  /** Creates a database page with a title + status property and a default table view. */
  async createDatabase(workspaceId: string, title: string, parentId: string | null = null) {
    return this.db.transaction(async (tx) => {
      const page = await this.pages.createIn(tx, { workspaceId, parentId, title, kind: 'database', icon: '🗂️' });
      const titleProp = uid();
      const statusProp = uid();
      await tx.run('INSERT INTO db_properties(id, database_id, name, type, options_json, sort_order) VALUES (?,?,?,?,?,?)', [
        titleProp, page.id, 'Name', 'title', '{}', 0,
      ]);
      await tx.run('INSERT INTO db_properties(id, database_id, name, type, options_json, sort_order) VALUES (?,?,?,?,?,?)', [
        statusProp, page.id, 'Status', 'status', JSON.stringify({ options: defaultStatusOptions() }), 1,
      ]);
      await tx.run('INSERT INTO db_views(id, database_id, name, type, config_json, sort_order) VALUES (?,?,?,?,?,?)', [
        uid(), page.id, 'Table', 'table', '{}', 0,
      ]);
      return page;
    });
  }

  async properties(databaseId: string) {
    return (
      await this.db.all<RawProp>('SELECT * FROM db_properties WHERE database_id = ? ORDER BY sort_order', [databaseId])
    ).map(toProp);
  }

  async addProperty(databaseId: string, name: string, type: PropertyType, options: PropertyOptions = {}) {
    if (type === 'title') throw new Error('A database has exactly one title property');
    if ((type === 'select' || type === 'multi_select') && !options.options) options.options = [];
    if (type === 'status' && !options.options) options.options = defaultStatusOptions();
    if (type === 'formula' && !options.expression) options.expression = '';
    const max = await this.db.get<{ m: number | null }>('SELECT MAX(sort_order) m FROM db_properties WHERE database_id = ?', [
      databaseId,
    ]);
    const prop: DbProperty = { id: uid(), database_id: databaseId, name: name.trim() || 'Property', type, options, sort_order: (max?.m ?? 0) + 1 };
    await this.db.run('INSERT INTO db_properties(id, database_id, name, type, options_json, sort_order) VALUES (?,?,?,?,?,?)', [
      prop.id, databaseId, prop.name, type, JSON.stringify(options), prop.sort_order,
    ]);
    return prop;
  }

  async updateProperty(id: string, patch: { name?: string; options?: PropertyOptions; type?: PropertyType }) {
    const cur = await this.db.get<RawProp>('SELECT * FROM db_properties WHERE id = ?', [id]);
    if (!cur) throw new Error('Property not found');
    if (patch.type && cur.type === 'title') throw new Error('The title property type cannot be changed');
    if (patch.type === 'title') throw new Error('A database has exactly one title property');
    await this.db.run('UPDATE db_properties SET name = ?, type = ?, options_json = ? WHERE id = ?', [
      patch.name?.trim() || cur.name,
      patch.type ?? cur.type,
      JSON.stringify(patch.options ?? parseJson(cur.options_json, {})),
      id,
    ]);
  }

  async removeProperty(id: string) {
    const cur = await this.db.get<RawProp>('SELECT * FROM db_properties WHERE id = ?', [id]);
    if (!cur) return;
    if (cur.type === 'title') throw new Error('The title property cannot be deleted');
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM db_properties WHERE id = ?', [id]);
      const rows = await tx.all<RawRow>('SELECT * FROM db_rows WHERE database_id = ?', [cur.database_id]);
      for (const r of rows) {
        const values = parseJson<Record<string, CellValue>>(r.values_json, {});
        if (id in values) {
          delete values[id];
          await tx.run('UPDATE db_rows SET values_json = ? WHERE id = ?', [JSON.stringify(values), r.id]);
        }
      }
    });
  }

  /** Adds a select option on the fly (used when typing a new value). */
  async ensureOption(propertyId: string, name: string): Promise<SelectOption> {
    const cur = await this.db.get<RawProp>('SELECT * FROM db_properties WHERE id = ?', [propertyId]);
    if (!cur) throw new Error('Property not found');
    const opts = parseJson<PropertyOptions>(cur.options_json, {});
    const list = opts.options ?? [];
    const existing = list.find((o) => o.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing;
    const opt = { id: uid(), name: name.trim(), color: COLORS[list.length % COLORS.length] };
    opts.options = [...list, opt];
    await this.db.run('UPDATE db_properties SET options_json = ? WHERE id = ?', [JSON.stringify(opts), propertyId]);
    return opt;
  }

  async rows(databaseId: string) {
    return (await this.db.all<RawRow>('SELECT * FROM db_rows WHERE database_id = ? ORDER BY sort_order, created_at', [databaseId])).map(
      toRow,
    );
  }

  async addRow(databaseId: string, values: Record<string, CellValue> = {}): Promise<DbRow> {
    return this.db.transaction(async (tx) => {
      const db = await tx.get<{ workspace_id: string; kind: string }>('SELECT workspace_id, kind FROM pages WHERE id = ?', [databaseId]);
      if (!db || db.kind !== 'database') throw new Error('Database not found');
      const max = await tx.get<{ m: number | null }>('SELECT MAX(sort_order) m FROM db_rows WHERE database_id = ?', [databaseId]);
      const t = now();
      const row: DbRow = { id: uid(), database_id: databaseId, values, sort_order: (max?.m ?? 0) + 1, created_at: t, updated_at: t };
      await tx.run('INSERT INTO db_rows(id, database_id, values_json, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)', [
        row.id, databaseId, JSON.stringify(values), row.sort_order, t, t,
      ]);
      await this.indexRow(tx, row, db.workspace_id);
      return row;
    });
  }

  async updateCell(rowId: string, propertyId: string, value: CellValue) {
    await this.db.transaction(async (tx) => {
      const r = await tx.get<RawRow>('SELECT * FROM db_rows WHERE id = ?', [rowId]);
      if (!r) throw new Error('Row not found');
      const values = parseJson<Record<string, CellValue>>(r.values_json, {});
      values[propertyId] = value;
      const t = now();
      await tx.run('UPDATE db_rows SET values_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(values), t, rowId]);
      const ws = await tx.get<{ workspace_id: string }>('SELECT workspace_id FROM pages WHERE id = ?', [r.database_id]);
      await this.indexRow(tx, { ...toRow(r), values }, ws!.workspace_id);
    });
  }

  async moveRow(rowId: string, sortOrder: number) {
    await this.db.run('UPDATE db_rows SET sort_order = ? WHERE id = ?', [sortOrder, rowId]);
  }

  async deleteRow(rowId: string) {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM db_rows WHERE id = ?', [rowId]);
      await indexRemove(tx, 'row', rowId);
    });
  }

  private async indexRow(tx: Parameters<typeof indexUpsert>[0], row: DbRow, workspaceId: string) {
    const props = (await tx.all<RawProp>('SELECT * FROM db_properties WHERE database_id = ?', [row.database_id])).map(toProp);
    const titleProp = props.find((p) => p.type === 'title');
    const title = titleProp ? String(row.values[titleProp.id] ?? '') : '';
    const body = props
      .filter((p) => p.type !== 'title')
      .map((p) => `${p.name}: ${displayValue(p, row.values[p.id])}`)
      .join('\n');
    await indexUpsert(tx, 'row', row.id, workspaceId, row.database_id, title, body);
  }

  async views(databaseId: string) {
    return (await this.db.all<RawView>('SELECT * FROM db_views WHERE database_id = ? ORDER BY sort_order', [databaseId])).map(toView);
  }

  async addView(databaseId: string, name: string, type: ViewType, config: ViewConfig = {}) {
    const max = await this.db.get<{ m: number | null }>('SELECT MAX(sort_order) m FROM db_views WHERE database_id = ?', [databaseId]);
    const view: DbView = { id: uid(), database_id: databaseId, name, type, config, sort_order: (max?.m ?? 0) + 1 };
    await this.db.run('INSERT INTO db_views(id, database_id, name, type, config_json, sort_order) VALUES (?,?,?,?,?,?)', [
      view.id, databaseId, name, type, JSON.stringify(config), view.sort_order,
    ]);
    return view;
  }

  async updateView(id: string, patch: { name?: string; type?: ViewType; config?: ViewConfig }) {
    const cur = await this.db.get<RawView>('SELECT * FROM db_views WHERE id = ?', [id]);
    if (!cur) throw new Error('View not found');
    await this.db.run('UPDATE db_views SET name = ?, type = ?, config_json = ? WHERE id = ?', [
      patch.name ?? cur.name,
      patch.type ?? cur.type,
      JSON.stringify(patch.config ?? parseJson(cur.config_json, {})),
      id,
    ]);
  }

  async removeView(id: string) {
    const cur = await this.db.get<RawView>('SELECT * FROM db_views WHERE id = ?', [id]);
    if (!cur) return;
    const count = await this.db.get<{ c: number }>('SELECT COUNT(*) c FROM db_views WHERE database_id = ?', [cur.database_id]);
    if ((count?.c ?? 0) <= 1) throw new Error('A database needs at least one view');
    await this.db.run('DELETE FROM db_views WHERE id = ?', [id]);
  }

  listDatabases(workspaceId: string) {
    return this.db.all<{ id: string; title: string; icon: string | null; updated_at: number; row_count: number }>(
      `SELECT p.id, p.title, p.icon, p.updated_at, (SELECT COUNT(*) FROM db_rows r WHERE r.database_id = p.id) AS row_count
       FROM pages p WHERE p.workspace_id = ? AND p.kind = 'database' AND p.deleted_at IS NULL ORDER BY p.updated_at DESC`,
      [workspaceId],
    );
  }

  /** Title lookup for relation cells. */
  async rowTitles(databaseId: string): Promise<{ id: string; title: string }[]> {
    const props = await this.properties(databaseId);
    const titleProp = props.find((p) => p.type === 'title');
    return (await this.rows(databaseId)).map((r) => ({ id: r.id, title: titleProp ? String(r.values[titleProp.id] ?? '') : r.id }));
  }
}

export function displayValue(prop: DbProperty, value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  switch (prop.type) {
    case 'checkbox':
      return value ? '✓' : '';
    case 'select':
    case 'status':
      return prop.options.options?.find((o) => o.id === value)?.name ?? '';
    case 'multi_select':
      return (Array.isArray(value) ? value : [])
        .map((id) => prop.options.options?.find((o) => o.id === id)?.name)
        .filter(Boolean)
        .join(', ');
    case 'relation':
      return Array.isArray(value) ? `${value.length} linked` : '';
    case 'date':
      return typeof value === 'string' && value ? new Date(value).toLocaleDateString() : '';
    default:
      return String(value);
  }
}

/** Evaluates formula cells for a row (formulas are computed, never stored). */
export function computedValue(prop: DbProperty, row: DbRow, props: DbProperty[]): CellValue {
  if (prop.type !== 'formula') return row.values[prop.id] ?? null;
  const result = evaluateFormula(prop.options.expression ?? '', (name) => {
    const p = props.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!p || p.type === 'formula') return null;
    const v = row.values[p.id];
    if (p.type === 'select' || p.type === 'status') return displayValue(p, v);
    return v ?? null;
  });
  return result.ok ? result.value : `#ERR ${result.error}`;
}

function compare(a: CellValue, b: CellValue): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Applies a view's filters and sorts. Pure, so it is unit-tested directly. */
export function applyView(rows: DbRow[], props: DbProperty[], config: ViewConfig): DbRow[] {
  const byId = new Map(props.map((p) => [p.id, p]));
  const valueOf = (row: DbRow, pid: string): CellValue => {
    const p = byId.get(pid);
    return p ? computedValue(p, row, props) : null;
  };
  let out = rows.filter((row) =>
    (config.filters ?? []).every((f) => {
      const p = byId.get(f.propertyId);
      if (!p) return true;
      const raw = valueOf(row, f.propertyId);
      const text = displayValue(p, raw).toLowerCase();
      const needle = (f.value ?? '').toLowerCase();
      switch (f.op) {
        case 'contains':
          return text.includes(needle);
        case 'not_contains':
          return !text.includes(needle);
        case 'equals':
          return text === needle;
        case 'not_equals':
          return text !== needle;
        case 'gt':
          return p.type === 'date' ? String(raw ?? '') > (f.value ?? '') : Number(raw) > Number(f.value);
        case 'lt':
          return p.type === 'date' ? String(raw ?? '') < (f.value ?? '') && !!raw : Number(raw) < Number(f.value);
        case 'is_empty':
          return text === '';
        case 'is_not_empty':
          return text !== '';
        case 'is_checked':
          return raw === true;
        case 'is_not_checked':
          return raw !== true;
        default:
          return true;
      }
    }),
  );
  const sorts = config.sorts ?? [];
  if (sorts.length) {
    out = [...out].sort((a, b) => {
      for (const s of sorts) {
        const p = byId.get(s.propertyId);
        if (!p) continue;
        const va = p.type === 'select' || p.type === 'status' ? displayValue(p, valueOf(a, s.propertyId)) : valueOf(a, s.propertyId);
        const vb = p.type === 'select' || p.type === 'status' ? displayValue(p, valueOf(b, s.propertyId)) : valueOf(b, s.propertyId);
        const c = compare(va, vb);
        if (c !== 0) return s.direction === 'asc' ? c : -c;
      }
      return a.sort_order - b.sort_order;
    });
  }
  return out;
}

export interface RowGroup {
  key: string;
  label: string;
  color: string;
  rows: DbRow[];
}

export function groupRows(rows: DbRow[], prop: DbProperty | undefined): RowGroup[] {
  if (!prop) return [{ key: 'all', label: 'All', color: 'gray', rows }];
  if (prop.type === 'select' || prop.type === 'status') {
    const groups: RowGroup[] = (prop.options.options ?? []).map((o) => ({ key: o.id, label: o.name, color: o.color, rows: [] }));
    const none: RowGroup = { key: '', label: 'No value', color: 'gray', rows: [] };
    for (const r of rows) {
      const g = groups.find((x) => x.key === r.values[prop.id]);
      (g ?? none).rows.push(r);
    }
    return none.rows.length ? [none, ...groups] : groups;
  }
  if (prop.type === 'checkbox') {
    return [
      { key: 'true', label: '✓', color: 'green', rows: rows.filter((r) => r.values[prop.id] === true) },
      { key: 'false', label: '—', color: 'gray', rows: rows.filter((r) => r.values[prop.id] !== true) },
    ];
  }
  const map = new Map<string, DbRow[]>();
  for (const r of rows) {
    const k = displayValue(prop, r.values[prop.id]);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()].map(([k, rs]) => ({ key: k, label: k || 'No value', color: 'gray', rows: rs }));
}
