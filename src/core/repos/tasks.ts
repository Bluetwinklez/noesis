import type { Database } from '../db/driver';
import type { Recurrence, Task, TaskStatus } from '../types';
import { now, uid } from '../../lib/util';
import { indexRemove, indexUpsert } from './search-index';

export interface TaskInput {
  workspaceId: string;
  title: string;
  parentId?: string | null;
  projectPageId?: string | null;
  sourcePageId?: string | null;
  notes?: string;
  priority?: number;
  dueAt?: number | null;
  remindAt?: number | null;
  recurrence?: Recurrence | null;
  status?: TaskStatus;
}

export function nextOccurrence(ts: number, rule: Recurrence): number {
  const d = new Date(ts);
  switch (rule) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly': {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      break;
    }
    case 'yearly': {
      // Feb 29 → Feb 28 in non-leap years (instead of overflowing into March).
      const day = d.getDate();
      d.setDate(1);
      d.setFullYear(d.getFullYear() + 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      break;
    }
  }
  return d.getTime();
}

export class TaskRepo {
  constructor(private db: Database) {}

  async create(input: TaskInput): Promise<Task> {
    const title = input.title.trim();
    if (!title) throw new Error('Task title is required');
    const t = now();
    const task: Task = {
      id: uid(),
      workspace_id: input.workspaceId,
      parent_id: input.parentId ?? null,
      project_page_id: input.projectPageId ?? null,
      source_page_id: input.sourcePageId ?? null,
      title: title.slice(0, 500),
      notes: input.notes ?? '',
      status: input.status ?? 'todo',
      priority: Math.min(3, Math.max(0, input.priority ?? 2)),
      due_at: input.dueAt ?? null,
      remind_at: input.remindAt ?? null,
      notified_at: null,
      recurrence: input.recurrence ?? null,
      completed_at: null,
      sort_order: t,
      created_at: t,
      updated_at: t,
    };
    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO tasks(id, workspace_id, parent_id, project_page_id, source_page_id, title, notes, status, priority,
          due_at, remind_at, notified_at, recurrence, completed_at, sort_order, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          task.id, task.workspace_id, task.parent_id, task.project_page_id, task.source_page_id, task.title, task.notes,
          task.status, task.priority, task.due_at, task.remind_at, null, task.recurrence, null, task.sort_order, t, t,
        ],
      );
      await indexUpsert(tx, 'task', task.id, task.workspace_id, task.parent_id, task.title, task.notes);
    });
    return task;
  }

  get(id: string) {
    return this.db.get<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
  }

  list(workspaceId: string) {
    return this.db.all<Task>('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY sort_order', [workspaceId]);
  }

  listForProject(pageId: string) {
    return this.db.all<Task>('SELECT * FROM tasks WHERE project_page_id = ? ORDER BY sort_order', [pageId]);
  }

  async update(id: string, patch: Partial<Omit<Task, 'id' | 'workspace_id' | 'created_at'>>) {
    const cur = await this.get(id);
    if (!cur) throw new Error('Task not found');
    if (patch.parent_id) {
      if (patch.parent_id === id) throw new Error('A task cannot be its own subtask');
      const parent = await this.get(patch.parent_id);
      if (parent?.parent_id === id) throw new Error('Circular subtask relationship');
    }
    const next = { ...cur, ...patch, updated_at: now() };
    if (patch.title !== undefined && !patch.title.trim()) throw new Error('Task title is required');
    if ('remind_at' in patch || 'due_at' in patch) next.notified_at = null;
    await this.db.transaction(async (tx) => {
      await tx.run(
        `UPDATE tasks SET parent_id=?, project_page_id=?, title=?, notes=?, status=?, priority=?, due_at=?, remind_at=?,
         notified_at=?, recurrence=?, completed_at=?, sort_order=?, updated_at=? WHERE id = ?`,
        [
          next.parent_id, next.project_page_id, next.title, next.notes, next.status, next.priority, next.due_at,
          next.remind_at, next.notified_at, next.recurrence, next.completed_at, next.sort_order, next.updated_at, id,
        ],
      );
      await indexUpsert(tx, 'task', id, cur.workspace_id, next.parent_id, next.title, next.notes);
    });
    return next;
  }

  /**
   * Completes a task. Recurring tasks spawn the next occurrence so history is
   * preserved. Returns the follow-up task when one was created.
   */
  async complete(id: string): Promise<Task | null> {
    const cur = await this.get(id);
    if (!cur) throw new Error('Task not found');
    // Completing twice (double click, two windows) must not spawn a second occurrence.
    if (cur.status === 'done') return null;
    await this.update(id, { status: 'done', completed_at: now() });
    if (!cur.recurrence) return null;
    const base = cur.due_at ?? now();
    const due = nextOccurrence(base, cur.recurrence);
    return this.create({
      workspaceId: cur.workspace_id,
      title: cur.title,
      notes: cur.notes,
      parentId: cur.parent_id,
      projectPageId: cur.project_page_id,
      priority: cur.priority,
      dueAt: due,
      remindAt: cur.remind_at ? due - (base - cur.remind_at) : null,
      recurrence: cur.recurrence,
    });
  }

  async reopen(id: string) {
    await this.update(id, { status: 'todo', completed_at: null });
  }

  async remove(id: string) {
    await this.db.transaction(async (tx) => {
      const sub = await tx.all<{ id: string }>(
        'WITH RECURSIVE s(id) AS (SELECT ? UNION ALL SELECT t.id FROM tasks t JOIN s ON t.parent_id = s.id) SELECT id FROM s',
        [id],
      );
      for (const s of sub) await indexRemove(tx, 'task', s.id);
      await tx.run('DELETE FROM tasks WHERE id = ?', [id]);
    });
  }

  /** Reminders that are due and not yet delivered. */
  dueReminders(at = now()) {
    return this.db.all<Task>(
      `SELECT * FROM tasks WHERE remind_at IS NOT NULL AND remind_at <= ? AND notified_at IS NULL
       AND status NOT IN ('done','cancelled')`,
      [at],
    );
  }

  async markNotified(id: string) {
    await this.db.run('UPDATE tasks SET notified_at = ? WHERE id = ?', [now(), id]);
  }
}
