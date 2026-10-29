import type { Database } from '../db/driver';
import { now, uid } from '../../lib/util';

export type AgentAction = 'create_page' | 'append_to_page' | 'clip_web_page' | 'create_task';

export interface AgentActivity {
  id: string;
  workspace_id: string;
  client: string;
  action: AgentAction;
  page_id: string | null;
  task_id: string | null;
  created_at: number;
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

  list(workspaceId: string, limit = 500): Promise<AgentActivity[]> {
    return this.db.all<AgentActivity>('SELECT * FROM agent_activity WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?', [workspaceId, limit]);
  }
}
