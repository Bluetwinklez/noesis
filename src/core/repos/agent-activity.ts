import type { Database } from '../db/driver';
import { now, uid } from '../../lib/util';

export type AgentAction =
  | 'create_page'
  | 'append_to_page'
  | 'clip_web_page'
  | 'create_task'
  | 'update_page'
  | 'move_page'
  | 'rename_page'
  | 'trash_page'
  | 'restore_page'
  | 'merge_pages';

export const AGENT_ACTIONS: readonly AgentAction[] = [
  'create_page',
  'append_to_page',
  'clip_web_page',
  'create_task',
  'update_page',
  'move_page',
  'rename_page',
  'trash_page',
  'restore_page',
  'merge_pages',
] as const;

export interface AgentActivity {
  id: string;
  workspace_id: string;
  client: string;
  action: AgentAction;
  page_id: string | null;
  task_id: string | null;
  created_at: number;
}

export interface AgentActivityEntry extends AgentActivity {
  title: string | null;
}

export interface AgentActivityFilter {
  client?: string;
  action?: AgentAction;
  limit?: number;
  offset?: number;
}

export interface AgentActivityPage {
  items: AgentActivityEntry[];
  total: number;
  hasMore: boolean;
}

/** Remembers which AI client wrote what through MCP, so the graph can show each agent's work. */
export class AgentActivityRepo {
  constructor(private db: Database) {}

  async record(input: { workspaceId: string; client: string; action: AgentAction; pageId?: string | null; taskId?: string | null; createdAt?: number }): Promise<void> {
    const client = input.client.trim().slice(0, 200) || 'Unknown client';
    await this.db.run(
      'INSERT INTO agent_activity(id, workspace_id, client, action, page_id, task_id, created_at) VALUES (?,?,?,?,?,?,?)',
      [uid(), input.workspaceId, client, input.action, input.pageId ?? null, input.taskId ?? null, input.createdAt ?? now()],
    );
  }

  /** Newest first, with the title of the page or task each entry wrote. */
  forClient(workspaceId: string, client: string, limit = 50): Promise<AgentActivityEntry[]> {
    return this.db.all(
      `SELECT a.*, COALESCE(p.title, t.title) AS title FROM agent_activity a
       LEFT JOIN pages p ON p.id = a.page_id AND p.deleted_at IS NULL
       LEFT JOIN tasks t ON t.id = a.task_id
       WHERE a.workspace_id = ? AND a.client = ? ORDER BY a.created_at DESC LIMIT ?`,
      [workspaceId, client, limit],
    );
  }

  /**
   * Combined workspace timeline (newest first) with optional client and action filters
   * and offset paging. Keeps trashed page titles visible so trash_page entries remain legible.
   */
  async listFiltered(workspaceId: string, opts: AgentActivityFilter = {}): Promise<AgentActivityPage> {
    const rawLimit = typeof opts.limit === 'number' && Number.isFinite(opts.limit) ? Math.floor(opts.limit) : 50;
    const limit = Math.max(1, Math.min(500, rawLimit));
    const rawOffset = typeof opts.offset === 'number' && Number.isFinite(opts.offset) ? Math.floor(opts.offset) : 0;
    const offset = Math.max(0, rawOffset);

    const where: string[] = ['a.workspace_id = ?'];
    const params: (string | number)[] = [workspaceId];

    const client = opts.client?.trim();
    if (client) {
      where.push('a.client = ?');
      params.push(client);
    }
    if (opts.action) {
      where.push('a.action = ?');
      params.push(opts.action);
    }

    const clause = where.join(' AND ');
    const countRow = await this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM agent_activity a WHERE ${clause}`, params);
    const total = countRow?.n ?? 0;

    const items = await this.db.all<AgentActivityEntry>(
      `SELECT a.*, COALESCE(p.title, t.title) AS title
       FROM agent_activity a
       LEFT JOIN pages p ON p.id = a.page_id AND p.workspace_id = a.workspace_id
       LEFT JOIN tasks t ON t.id = a.task_id AND t.workspace_id = a.workspace_id
       WHERE ${clause}
       ORDER BY a.created_at DESC, a.rowid DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return { items, total, hasMore: offset + items.length < total };
  }

  /** Distinct client names with recorded activity in this workspace, sorted alphabetically. */
  async listClients(workspaceId: string): Promise<string[]> {
    const rows = await this.db.all<{ client: string }>(
      'SELECT DISTINCT client FROM agent_activity WHERE workspace_id = ? ORDER BY client COLLATE NOCASE ASC',
      [workspaceId],
    );
    return rows.map((r) => r.client);
  }

  list(workspaceId: string, limit = 500): Promise<AgentActivity[]> {
    return this.db.all<AgentActivity>('SELECT * FROM agent_activity WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?', [workspaceId, limit]);
  }
}
