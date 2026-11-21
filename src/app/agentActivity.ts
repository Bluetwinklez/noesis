/** How long an MCP client stays marked as working after its latest write (5 minutes). */
export const AGENT_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

/** Minimum interval between state emissions so bursts of MCP writes do not cause re-render storms. */
export const AGENT_ACTIVITY_THROTTLE_MS = 2_500;

export interface AgentActivityStamp {
  client: string;
  at: number;
}

export interface AgentActivitySnapshot {
  lastAgentActivity: AgentActivityStamp | null;
  activeAgents: AgentActivityStamp[];
}

export interface AgentActivityTracker {
  record(client: string, at?: number): void;
  prune(): void;
  clear(): void;
  snapshot(): AgentActivitySnapshot;
}

export function normalizeClientName(client: string): string {
  return client.trim().slice(0, 200) || 'Unknown client';
}

/** Keeps entries strictly within the activity window, sorted newest first. */
export function pruneActiveAgents(
  entries: readonly AgentActivityStamp[],
  nowMs: number,
  windowMs = AGENT_ACTIVE_WINDOW_MS,
): AgentActivityStamp[] {
  const cutoff = nowMs - windowMs;
  return entries
    .filter((e) => Number.isFinite(e.at) && e.at > cutoff)
    .sort((a, b) => b.at - a.at || a.client.localeCompare(b.client));
}

/** Records or updates a client's timestamp and prunes any expired clients. */
export function mergeAgentActivity(
  entries: readonly AgentActivityStamp[],
  client: string,
  at: number,
  nowMs = at,
  windowMs = AGENT_ACTIVE_WINDOW_MS,
): AgentActivityStamp[] {
  const name = normalizeClientName(client);
  const byClient = new Map<string, number>();
  for (const e of entries) {
    const prev = byClient.get(e.client);
    if (prev === undefined || e.at > prev) byClient.set(e.client, e.at);
  }
  const existing = byClient.get(name);
  if (existing === undefined || at >= existing) {
    byClient.set(name, at);
  }
  const merged: AgentActivityStamp[] = [];
  for (const [c, ts] of byClient) merged.push({ client: c, at: ts });
  return pruneActiveAgents(merged, nowMs, windowMs);
}

/** Formats active client names for compact chrome display (e.g. "Claude Code, Codex +1"). */
export function formatActiveAgentNames(agents: readonly AgentActivityStamp[], maxVisible = 2): string {
  const names = agents.map((a) => a.client);
  if (names.length <= maxVisible) return names.join(', ');
  return `${names.slice(0, maxVisible).join(', ')} +${names.length - maxVisible}`;
}

function snapshotsEqual(a: AgentActivitySnapshot, b: AgentActivitySnapshot): boolean {
  if (a.activeAgents.length !== b.activeAgents.length) return false;
  if (a.lastAgentActivity?.client !== b.lastAgentActivity?.client || a.lastAgentActivity?.at !== b.lastAgentActivity?.at) {
    return false;
  }
  for (let i = 0; i < a.activeAgents.length; i++) {
    if (a.activeAgents[i].client !== b.activeAgents[i].client || a.activeAgents[i].at !== b.activeAgents[i].at) {
      return false;
    }
  }
  return true;
}

/**
 * Tracks recently active MCP clients with leading+trailing throttling and automatic timeout clearing.
 * Bursts of agent writes coalesce into at most one state update per `throttleMs`, and clients expire
 * once `windowMs` has elapsed since their latest write.
 */
export function createAgentActivityTracker(opts: {
  onChange: (snap: AgentActivitySnapshot) => void;
  now?: () => number;
  windowMs?: number;
  throttleMs?: number;
}): AgentActivityTracker {
  const nowFn = opts.now ?? (() => Date.now());
  const windowMs = opts.windowMs ?? AGENT_ACTIVE_WINDOW_MS;
  const throttleMs = opts.throttleMs ?? AGENT_ACTIVITY_THROTTLE_MS;

  let buffer: AgentActivityStamp[] = [];
  let committed: AgentActivitySnapshot = { lastAgentActivity: null, activeAgents: [] };
  let lastEmitAt = -Infinity;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (throttleTimer !== null) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  };

  const scheduleExpiry = (nowMs: number) => {
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    if (buffer.length === 0) return;
    let earliestAt = buffer[0].at;
    for (const e of buffer) if (e.at < earliestAt) earliestAt = e.at;
    const delay = Math.min(2_147_483_647, Math.max(0, earliestAt + windowMs - nowMs));
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      emit(nowFn());
    }, delay);
  };

  const emit = (nowMs: number) => {
    buffer = pruneActiveAgents(buffer, nowMs, windowMs);
    const activeAgents = buffer.map((e) => ({ ...e }));
    const next: AgentActivitySnapshot = {
      lastAgentActivity: activeAgents[0] ?? null,
      activeAgents,
    };
    scheduleExpiry(nowMs);
    if (snapshotsEqual(committed, next)) return;
    committed = next;
    lastEmitAt = nowMs;
    opts.onChange(next);
  };

  return {
    record(client: string, at?: number) {
      const nowMs = nowFn();
      const stampAt = at ?? nowMs;
      buffer = mergeAgentActivity(buffer, client, stampAt, nowMs, windowMs);
      const elapsed = nowMs - lastEmitAt;
      if (elapsed >= throttleMs) {
        if (throttleTimer !== null) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        emit(nowMs);
      } else {
        scheduleExpiry(nowMs);
        if (throttleTimer === null) {
          const wait = Math.max(0, throttleMs - elapsed);
          throttleTimer = setTimeout(() => {
            throttleTimer = null;
            emit(nowFn());
          }, wait);
        }
      }
    },

    prune() {
      emit(nowFn());
    },

    clear() {
      clearTimers();
      buffer = [];
      lastEmitAt = -Infinity;
      const next: AgentActivitySnapshot = { lastAgentActivity: null, activeAgents: [] };
      if (!snapshotsEqual(committed, next)) {
        committed = next;
        opts.onChange(next);
      }
    },

    snapshot() {
      return committed;
    },
  };
}
