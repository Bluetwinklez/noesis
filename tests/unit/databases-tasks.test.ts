import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { memoryStore } from '../helpers';
import { applyView, computedValue, groupRows } from '../../src/core/repos/databases';
import { evaluateFormula } from '../../src/core/formula';
import { nextOccurrence } from '../../src/core/repos/tasks';
import { search } from '../../src/search/search';

let s: Repos;
let ws: string;
beforeEach(async () => {
  s = await memoryStore();
  ws = (await s.workspaces.create('Main')).id;
});

describe('formula engine', () => {
  const lookup = (vals: Record<string, unknown>) => (n: string) => (vals[n] ?? null) as never;
  it('evaluates arithmetic, functions and props', () => {
    expect(evaluateFormula('prop("Price") * prop("Qty")', lookup({ Price: 2.5, Qty: 4 }))).toEqual({ ok: true, value: 10 });
    expect(evaluateFormula('if(prop("Qty") > 3, "bulk", "single")', lookup({ Qty: 5 }))).toEqual({ ok: true, value: 'bulk' });
    expect(evaluateFormula('concat(upper("a"), "-", round(3.14159, 2))', lookup({}))).toEqual({ ok: true, value: 'A-3.14' });
    expect(evaluateFormula('1 + 2 * 3 - (4 / 2)', lookup({}))).toEqual({ ok: true, value: 5 });
  });
  it('reports errors instead of throwing', () => {
    expect(evaluateFormula('1 / 0', lookup({})).ok).toBe(false);
    expect(evaluateFormula('foo(1)', lookup({})).ok).toBe(false);
    expect(evaluateFormula('"unterminated', lookup({})).ok).toBe(false);
    expect(evaluateFormula('alert(1)', lookup({})).ok).toBe(false);
    expect(evaluateFormula('('.repeat(200) + '1' + ')'.repeat(200), lookup({})).ok).toBe(false);
  });
});

describe('structured databases', () => {
  it('creates a database with properties, rows, views and persists them', async () => {
    const dbPage = await s.databases.createDatabase(ws, 'Reading list');
    const props = await s.databases.properties(dbPage.id);
    const title = props.find((p) => p.type === 'title')!;
    const status = props.find((p) => p.type === 'status')!;
    const pages = await s.databases.addProperty(dbPage.id, 'Pages', 'number');
    const genre = await s.databases.addProperty(dbPage.id, 'Genre', 'select');
    const fiction = await s.databases.ensureOption(genre.id, 'Fiction');
    expect((await s.databases.ensureOption(genre.id, 'fiction')).id).toBe(fiction.id);
    const formula = await s.databases.addProperty(dbPage.id, 'Long?', 'formula', { expression: 'if(prop("Pages") > 300, "long", "short")' });

    const r1 = await s.databases.addRow(dbPage.id, { [title.id]: 'Dune', [pages.id]: 612, [genre.id]: fiction.id, [status.id]: 'done' });
    const r2 = await s.databases.addRow(dbPage.id, { [title.id]: 'Siddhartha', [pages.id]: 152 });
    await s.databases.updateCell(r2.id, status.id, 'in_progress');

    const allProps = await s.databases.properties(dbPage.id);
    const rows = await s.databases.rows(dbPage.id);
    expect(rows).toHaveLength(2);
    expect(computedValue(allProps.find((p) => p.id === formula.id)!, rows[0], allProps)).toBe('long');

    const sorted = applyView(rows, allProps, { sorts: [{ propertyId: pages.id, direction: 'asc' }] });
    expect(sorted.map((r) => r.id)).toEqual([r2.id, r1.id]);
    const filtered = applyView(rows, allProps, { filters: [{ propertyId: genre.id, op: 'equals', value: 'fiction' }] });
    expect(filtered.map((r) => r.id)).toEqual([r1.id]);
    const numeric = applyView(rows, allProps, { filters: [{ propertyId: pages.id, op: 'gt', value: '200' }] });
    expect(numeric).toHaveLength(1);

    const groups = groupRows(rows, allProps.find((p) => p.id === status.id));
    expect(groups.find((g) => g.key === 'done')?.rows).toHaveLength(1);
    expect(groups.find((g) => g.key === 'in_progress')?.rows).toHaveLength(1);

    const board = await s.databases.addView(dbPage.id, 'Board', 'board', { groupBy: status.id });
    await s.databases.updateView(board.id, { config: { groupBy: status.id, sorts: [{ propertyId: title.id, direction: 'desc' }] } });
    const views = await s.databases.views(dbPage.id);
    expect(views.map((v) => v.type)).toEqual(['table', 'board']);
    expect(views[1].config.sorts?.[0].direction).toBe('desc');

    const hits = await search(s.db, 'Siddhartha', { workspaceId: ws, mode: 'fulltext' });
    expect(hits.some((h) => h.kind === 'row' && h.refId === r2.id)).toBe(true);
  });

  it('protects the title property and the last view', async () => {
    const d = await s.databases.createDatabase(ws, 'X');
    const props = await s.databases.properties(d.id);
    await expect(s.databases.removeProperty(props[0].id)).rejects.toThrow();
    await expect(s.databases.addProperty(d.id, 'T2', 'title')).rejects.toThrow();
    const [v] = await s.databases.views(d.id);
    await expect(s.databases.removeView(v.id)).rejects.toThrow(/at least one view/);
  });

  it('removes values when a property is deleted', async () => {
    const d = await s.databases.createDatabase(ws, 'X');
    const p = await s.databases.addProperty(d.id, 'Notes', 'text');
    const r = await s.databases.addRow(d.id, { [p.id]: 'hello' });
    await s.databases.removeProperty(p.id);
    const [row] = await s.databases.rows(d.id);
    expect(row.id).toBe(r.id);
    expect(p.id in row.values).toBe(false);
  });
});

describe('tasks', () => {
  it('handles subtasks, completion and recurring tasks', async () => {
    const due = new Date(2026, 0, 31, 9).getTime();
    const t = await s.tasks.create({ workspaceId: ws, title: 'Pay rent', dueAt: due, recurrence: 'monthly', priority: 3 });
    const sub = await s.tasks.create({ workspaceId: ws, title: 'Check bank', parentId: t.id });
    expect(sub.parent_id).toBe(t.id);
    const next = await s.tasks.complete(t.id);
    expect((await s.tasks.get(t.id))?.status).toBe('done');
    expect(next).not.toBeNull();
    expect(new Date(next!.due_at!).getMonth()).toBe(1);
    expect(new Date(next!.due_at!).getDate()).toBe(28); // clamps Jan 31 → Feb 28
    await expect(s.tasks.update(t.id, { parent_id: t.id })).rejects.toThrow();
    await expect(s.tasks.create({ workspaceId: ws, title: '   ' })).rejects.toThrow();
  });

  it('returns due reminders once', async () => {
    const t = await s.tasks.create({ workspaceId: ws, title: 'Call', remindAt: Date.now() - 1000 });
    expect((await s.tasks.dueReminders()).map((x) => x.id)).toEqual([t.id]);
    await s.tasks.markNotified(t.id);
    expect(await s.tasks.dueReminders()).toHaveLength(0);
  });

  it('computes next occurrences', () => {
    const base = new Date(2026, 4, 10).getTime();
    expect(new Date(nextOccurrence(base, 'daily')).getDate()).toBe(11);
    expect(new Date(nextOccurrence(base, 'weekly')).getDate()).toBe(17);
    expect(new Date(nextOccurrence(base, 'yearly')).getFullYear()).toBe(2027);
  });

  it('deleting a parent removes subtasks', async () => {
    const t = await s.tasks.create({ workspaceId: ws, title: 'Parent' });
    await s.tasks.create({ workspaceId: ws, title: 'Child', parentId: t.id });
    await s.tasks.remove(t.id);
    expect(await s.tasks.list(ws)).toHaveLength(0);
  });
});
