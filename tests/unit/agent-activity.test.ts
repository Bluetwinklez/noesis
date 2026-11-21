import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repos } from '../../src/core/store';
import { AGENT_ACTIONS } from '../../src/core/repos/agent-activity';
import {
  AGENT_ACTIVE_WINDOW_MS,
  AGENT_ACTIVITY_THROTTLE_MS,
  createAgentActivityTracker,
  formatActiveAgentNames,
  mergeAgentActivity,
  normalizeClientName,
  pruneActiveAgents,
  type AgentActivitySnapshot,
} from '../../src/app/agentActivity';
import { useApp } from '../../src/app/state';
import { memoryStore } from '../helpers';

describe('AgentActivityRepo filtering and paging', () => {
  let s: Repos;
  let ws: string;

  beforeEach(async () => {
    s = await memoryStore();
    ws = (await s.workspaces.create('Main')).id;
  });

  it('returns entries newest-first with joined page and task titles, including trashed pages', async () => {
    const p1 = await s.pages.create({ workspaceId: ws, title: 'Alpha Page' });
    const p2 = await s.pages.create({ workspaceId: ws, title: 'Trashed Page' });
    const task = await s.tasks.create({ workspaceId: ws, title: 'Verify citations' });

    await s.activity.record({ workspaceId: ws, client: 'Codex', action: 'create_page', pageId: p1.id, createdAt: 1000 });
    await s.activity.record({ workspaceId: ws, client: 'Claude Code', action: 'create_task', taskId: task.id, createdAt: 2000 });
    await s.pages.trash(p2.id);
    await s.activity.record({ workspaceId: ws, client: 'Codex', action: 'trash_page', pageId: p2.id, createdAt: 3000 });

    const page = await s.activity.listFiltered(ws);
    expect(page.total).toBe(3);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((i) => ({ client: i.client, action: i.action, title: i.title }))).toEqual([
      { client: 'Codex', action: 'trash_page', title: 'Trashed Page' },
      { client: 'Claude Code', action: 'create_task', title: 'Verify citations' },
      { client: 'Codex', action: 'create_page', title: 'Alpha Page' },
    ]);
  });

  it('filters by client, by action, and by both combined across all nine actions', async () => {
    const p = await s.pages.create({ workspaceId: ws, title: 'Shared Note' });
    const task = await s.tasks.create({ workspaceId: ws, title: 'Shared Task' });

    let ts = 1000;
    for (const action of AGENT_ACTIONS) {
      await s.activity.record({
        workspaceId: ws,
        client: action === 'create_task' || action === 'rename_page' ? 'Claude Code' : 'Codex',
        action,
        pageId: action === 'create_task' ? null : p.id,
        taskId: action === 'create_task' ? task.id : null,
        createdAt: ts++,
      });
    }

    const all = await s.activity.listFiltered(ws);
    expect(all.total).toBe(AGENT_ACTIONS.length);

    const byClient = await s.activity.listFiltered(ws, { client: 'Claude Code' });
    expect(byClient.total).toBe(2);
    expect(byClient.items.map((i) => i.action)).toEqual(['rename_page', 'create_task']);

    const byAction = await s.activity.listFiltered(ws, { action: 'update_page' });
    expect(byAction.total).toBe(1);
    expect(byAction.items[0]).toMatchObject({ client: 'Codex', action: 'update_page', page_id: p.id });

    const combinedMatch = await s.activity.listFiltered(ws, { client: 'Claude Code', action: 'rename_page' });
    expect(combinedMatch.total).toBe(1);
    expect(combinedMatch.items[0]).toMatchObject({ client: 'Claude Code', action: 'rename_page' });

    const combinedEmpty = await s.activity.listFiltered(ws, { client: 'Codex', action: 'rename_page' });
    expect(combinedEmpty).toEqual({ items: [], total: 0, hasMore: false });
  });

  it('pages deterministically with offset and limit even when timestamps tie', async () => {
    const pages = await Promise.all(
      ['One', 'Two', 'Three', 'Four', 'Five'].map((title) => s.pages.create({ workspaceId: ws, title })),
    );
    // Insert with identical created_at timestamps to verify deterministic rowid tie-breaking.
    for (const p of pages) {
      await s.activity.record({ workspaceId: ws, client: 'Codex', action: 'create_page', pageId: p.id, createdAt: 5000 });
    }

    const page1 = await s.activity.listFiltered(ws, { limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);
    expect(page1.items.map((i) => i.title)).toEqual(['Five', 'Four']);

    const page2 = await s.activity.listFiltered(ws, { limit: 2, offset: 2 });
    expect(page2.total).toBe(5);
    expect(page2.hasMore).toBe(true);
    expect(page2.items.map((i) => i.title)).toEqual(['Three', 'Two']);

    const page3 = await s.activity.listFiltered(ws, { limit: 2, offset: 4 });
    expect(page3.total).toBe(5);
    expect(page3.hasMore).toBe(false);
    expect(page3.items.map((i) => i.title)).toEqual(['One']);

    const beyond = await s.activity.listFiltered(ws, { limit: 2, offset: 10 });
    expect(beyond).toEqual({ items: [], total: 5, hasMore: false });
  });

  it('lists distinct clients sorted alphabetically and isolates workspaces', async () => {
    const otherWs = (await s.workspaces.create('Other')).id;
    const myPage = await s.pages.create({ workspaceId: ws, title: 'My Note' });
    const otherPage = await s.pages.create({ workspaceId: otherWs, title: 'Secret Note' });

    await s.activity.record({ workspaceId: ws, client: 'Cursor', action: 'create_page', pageId: myPage.id, createdAt: 1000 });
    await s.activity.record({ workspaceId: ws, client: 'claude code', action: 'update_page', pageId: myPage.id, createdAt: 2000 });
    await s.activity.record({ workspaceId: ws, client: 'Codex', action: 'append_to_page', pageId: myPage.id, createdAt: 3000 });
    await s.activity.record({ workspaceId: ws, client: 'Codex', action: 'rename_page', pageId: myPage.id, createdAt: 4000 });
    await s.activity.record({ workspaceId: otherWs, client: 'Other Agent', action: 'create_page', pageId: otherPage.id, createdAt: 5000 });

    expect(await s.activity.listClients(ws)).toEqual(['claude code', 'Codex', 'Cursor']);
    expect(await s.activity.listClients(otherWs)).toEqual(['Other Agent']);

    const myEntries = await s.activity.listFiltered(ws);
    expect(myEntries.total).toBe(4);
    expect(myEntries.items.some((i) => i.client === 'Other Agent')).toBe(false);
  });
});

describe('Agent activity indicator state logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T12:00:00.000Z'));
    useApp.getState().clearAgentActivity();
  });

  afterEach(() => {
    useApp.getState().clearAgentActivity();
    vi.useRealTimers();
  });

  it('normalizes client names, merges deduplicated clients, prunes expired entries and formats labels', () => {
    expect(normalizeClientName('  Codex  ')).toBe('Codex');
    expect(normalizeClientName('   ')).toBe('Unknown client');
    expect(normalizeClientName('a'.repeat(250)).length).toBe(200);

    const base = 1_000_000;
    let active = mergeAgentActivity([], 'Codex', base, base);
    active = mergeAgentActivity(active, 'Claude Code', base + 1000, base + 1000);
    active = mergeAgentActivity(active, 'Codex', base + 2000, base + 2000);
    expect(active).toEqual([
      { client: 'Codex', at: base + 2000 },
      { client: 'Claude Code', at: base + 1000 },
    ]);

    // Claude Code expires at base + 1000 + windowMs; Codex remains active for another second.
    const pruned = pruneActiveAgents(active, base + 1000 + AGENT_ACTIVE_WINDOW_MS);
    expect(pruned).toEqual([{ client: 'Codex', at: base + 2000 }]);

    expect(formatActiveAgentNames([{ client: 'Codex', at: 1 }])).toBe('Codex');
    expect(formatActiveAgentNames([{ client: 'Codex', at: 2 }, { client: 'Claude Code', at: 1 }])).toBe('Codex, Claude Code');
    expect(
      formatActiveAgentNames([
        { client: 'Codex', at: 3 },
        { client: 'Claude Code', at: 2 },
        { client: 'Cursor', at: 1 },
      ]),
    ).toBe('Codex, Claude Code +1');
  });

  it('throttles bursts of writes to prevent re-render storms and flushes trailing updates', () => {
    const emissions: AgentActivitySnapshot[] = [];
    const tracker = createAgentActivityTracker({
      onChange: (snap) => emissions.push(snap),
    });

    // Leading edge emits immediately.
    tracker.record('Codex');
    expect(emissions).toHaveLength(1);
    expect(emissions[0].lastAgentActivity?.client).toBe('Codex');

    // Burst of 20 writes within the throttle window must not emit immediately.
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(50);
      tracker.record(i === 19 ? 'Claude Code' : 'Codex');
    }
    expect(emissions).toHaveLength(1);

    // After the remaining throttle interval elapses, one trailing emission delivers the latest state.
    vi.advanceTimersByTime(AGENT_ACTIVITY_THROTTLE_MS);
    expect(emissions).toHaveLength(2);
    expect(emissions[1].lastAgentActivity?.client).toBe('Claude Code');
    expect(emissions[1].activeAgents.map((a) => a.client)).toEqual(['Claude Code', 'Codex']);
  });

  it('expires older clients individually and clears lastAgentActivity after 5 minutes', () => {
    const emissions: AgentActivitySnapshot[] = [];
    const tracker = createAgentActivityTracker({
      onChange: (snap) => emissions.push(snap),
    });

    tracker.record('Codex');
    expect(tracker.snapshot().activeAgents.map((a) => a.client)).toEqual(['Codex']);

    // Second client writes 60 seconds later.
    vi.advanceTimersByTime(60_000);
    tracker.record('Claude Code');
    expect(tracker.snapshot().activeAgents.map((a) => a.client)).toEqual(['Claude Code', 'Codex']);
    expect(tracker.snapshot().lastAgentActivity?.client).toBe('Claude Code');

    // 4 minutes later (5 minutes since Codex), Codex expires while Claude Code remains active.
    vi.advanceTimersByTime(AGENT_ACTIVE_WINDOW_MS - 60_000);
    expect(tracker.snapshot().activeAgents.map((a) => a.client)).toEqual(['Claude Code']);
    expect(tracker.snapshot().lastAgentActivity?.client).toBe('Claude Code');

    // 1 more minute later (5 minutes since Claude Code), everything clears.
    vi.advanceTimersByTime(60_000);
    expect(tracker.snapshot()).toEqual({ lastAgentActivity: null, activeAgents: [] });
  });

  it('ignores already-expired timestamps and cancels pending timers on clear()', () => {
    const emissions: AgentActivitySnapshot[] = [];
    const tracker = createAgentActivityTracker({
      onChange: (snap) => emissions.push(snap),
    });

    tracker.record('Stale Client', Date.now() - AGENT_ACTIVE_WINDOW_MS - 1000);
    expect(emissions).toHaveLength(0);
    expect(tracker.snapshot()).toEqual({ lastAgentActivity: null, activeAgents: [] });

    tracker.record('Codex');
    vi.advanceTimersByTime(100);
    tracker.record('Claude Code'); // queued in throttle timer
    tracker.clear();
    expect(tracker.snapshot()).toEqual({ lastAgentActivity: null, activeAgents: [] });

    const countAfterClear = emissions.length;
    vi.advanceTimersByTime(AGENT_ACTIVE_WINDOW_MS + AGENT_ACTIVITY_THROTTLE_MS);
    expect(emissions).toHaveLength(countAfterClear);
  });

  it('updates useApp lastAgentActivity/activeAgents and clears after timeout', () => {
    useApp.getState().recordAgentActivity('Codex');
    expect(useApp.getState().lastAgentActivity?.client).toBe('Codex');
    expect(useApp.getState().activeAgents.map((a) => a.client)).toEqual(['Codex']);

    vi.advanceTimersByTime(AGENT_ACTIVE_WINDOW_MS);
    expect(useApp.getState().lastAgentActivity).toBeNull();
    expect(useApp.getState().activeAgents).toEqual([]);
  });
});
