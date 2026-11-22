import { create } from 'zustand';
import { isTauri } from '../lib/platform';
import { useApp } from '../app/state';
import { savePrefs } from '../app/services';
import { flushPageWrites } from '../app/pendingWrites';
import type { ApprovalRequest, McpContext } from './server';

/**
 * Connects the Rust MCP endpoint to the TypeScript MCP server: Rust emits
 * `mcp-request` for every message from an AI client, we answer through
 * `mcp_respond`. Approval requests queue up in `useMcpApprovals` and are
 * rendered by <McpApprovalDialog/>.
 */

export interface McpStatus {
  running: boolean;
  port: number | null;
  exe: string;
  /** Endpoint key, shown so it can be pasted into the web clipper extension. */
  token: string | null;
}

export interface ClientTarget {
  id: string;
  name: string;
  path: string | null;
  installed: boolean;
  connected: boolean;
}

interface PendingApproval extends ApprovalRequest {
  id: number;
  resolve: (ok: boolean) => void;
}

export const useMcpApprovals = create<{ queue: PendingApproval[] }>(() => ({ queue: [] }));

/** Unanswered approvals are declined shortly before the bridge gives up waiting. */
const APPROVAL_TIMEOUT_MS = 170_000;
let nextApproval = 0;

export function requestApproval(req: ApprovalRequest): Promise<boolean> {
  if (useApp.getState().prefs.mcpAutoApprove) return Promise.resolve(true);
  return new Promise((resolve) => {
    const id = ++nextApproval;
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      useMcpApprovals.setState((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
    useMcpApprovals.setState((s) => ({ queue: [...s.queue, { ...req, id, resolve: finish }] }));
  });
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Announces an MCP write in the UI: shows a toast, tracks active agents, and refreshes open views. */
export function notifyAgentWrite(client: string, message: string): void {
  const state = useApp.getState();
  state.toast(message, 'info');
  state.recordAgentActivity(client);
  state.bump();
}

/** Builds the live in-app MCP context, wiring approvals, notifications and open-editor refresh hooks. */
export function createMcpContext(client: string): McpContext {
  const { repos, workspaceId } = useApp.getState();
  if (!repos || !workspaceId) throw new Error('Noesis is still starting.');
  return {
    repos,
    workspaceId,
    client,
    approve: requestApproval,
    notify: (m) => notifyAgentWrite(client, m),
    beforePageReplace: (pageId) => flushPageWrites(pageId),
    afterPageReplace: (pageId) => useApp.getState().markPageReplaced(pageId),
    permissions: () => useApp.getState().prefs.mcpPermissions,
  };
}

let unlisten: (() => void) | null = null;

async function listen() {
  if (unlisten) return;
  const { listen } = await import('@tauri-apps/api/event');
  unlisten = await listen<{ rid: number; client: string; message: string }>('mcp-request', async ({ payload }) => {
    let body = '';
    try {
      const ctx = createMcpContext(payload.client);
      // Loaded on first use: the MCP server pulls in the editor schema and search.
      const { handleMcp } = await import('./server');
      const res = await handleMcp(JSON.parse(payload.message), ctx);
      body = res ? JSON.stringify(res) : '';
    } catch (e) {
      const id = (() => {
        try {
          return JSON.parse(payload.message).id ?? null;
        } catch {
          return null;
        }
      })();
      body = JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
    await invoke('mcp_respond', { rid: payload.rid, body });
  });
}

export async function startMcp(): Promise<McpStatus> {
  await listen();
  return invoke<McpStatus>('mcp_start');
}

export async function stopMcp(): Promise<void> {
  await invoke('mcp_stop');
}

export async function mcpStatus(): Promise<McpStatus | null> {
  return isTauri() ? invoke<McpStatus>('mcp_status') : null;
}

export async function setMcpEnabled(enabled: boolean): Promise<McpStatus | null> {
  await savePrefs({ mcpEnabled: enabled });
  if (enabled) return startMcp();
  await stopMcp();
  return mcpStatus();
}

export const listClients = () => invoke<ClientTarget[]>('mcp_clients');
export const connectClient = (id: string, connect: boolean) => invoke<string[]>('mcp_connect_client', { id, connect });

/** Starts the endpoint at launch when the user turned AI connections on earlier. */
export function startMcpIfEnabled() {
  if (isTauri() && useApp.getState().prefs.mcpEnabled) void startMcp().catch((e) => useApp.getState().toast(String(e), 'error'));
}
