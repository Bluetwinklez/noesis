// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { docFromParagraphs, PAGE_LINK_PREFIX, type DocNode } from '../../src/core/doc';
import { search } from '../../src/search/search';
import {
  DISABLED_CAPABILITY_ERROR,
  docPreview,
  handleMcp,
  toolList,
  type ApprovalRequest,
  type DestructiveActionInfo,
  type McpContext,
} from '../../src/mcp/server';
import { SafetySnapshotThrottle } from '../../src/mcp/safety-snapshot';
import { DEFAULT_MCP_PERMISSIONS, DEFAULT_PREFS, normalizeMcpPermissions, useApp, type McpPermissions } from '../../src/app/state';
import { loadSettings } from '../../src/app/services';
import { memoryStore } from '../helpers';

let s: Repos;
let ctx: McpContext;
let approvals: ApprovalRequest[];
let notices: string[];
let allow: boolean;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
  const r = res!.result as { content: { text: string }[]; isError?: boolean };
  return { isError: !!r.isError, text: r.content[0].text, json: () => JSON.parse(r.content[0].text) };
};

beforeEach(async () => {
  s = await memoryStore();
  const ws = (await s.workspaces.create('MCP')).id;
  approvals = [];
  notices = [];
  allow = true;
  ctx = {
    repos: s,
    workspaceId: ws,
    client: 'Test Client',
    approve: async (r) => {
      approvals.push(r);
      return allow;
    },
    notify: (m) => notices.push(m),
  };
});

describe('MCP server', () => {
  it('initializes, negotiates the protocol version and lists tools', async () => {
    const init = await handleMcp({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'x' } } }, ctx);
    expect((init!.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26');
    expect((init!.result as { serverInfo: { name: string } }).serverInfo.name).toBe('noesis');
    expect(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull();
    const list = await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);
    const tools = (list!.result as { tools: { name: string; annotations?: Record<string, boolean> }[] }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'search_notes',
        'list_pages',
        'list_recent_pages',
        'get_page_outline_tree',
        'read_page',
        'create_page',
        'append_to_page',
        'update_page',
        'move_page',
        'rename_page',
        'merge_pages',
        'trash_page',
        'restore_page',
        'find_duplicate_pages',
        'check_links',
        'list_trash',
        'get_backlinks',
        'list_tasks',
        'create_task',
        'search_sources',
      ]),
    );
    expect(tools.find((t) => t.name === 'trash_page')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'update_page')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'merge_pages')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'list_recent_pages')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'get_page_outline_tree')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'find_duplicate_pages')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'check_links')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'list_trash')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'get_backlinks')?.annotations?.readOnlyHint).toBe(true);
  });

  it('rejects malformed messages and unknown methods/tools', async () => {
    expect((await handleMcp({ hello: 1 }, ctx))!.error!.code).toBe(-32600);
    expect((await handleMcp({ jsonrpc: '2.0', id: 3, method: 'nope' }, ctx))!.error!.code).toBe(-32601);
    expect((await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'rm_rf' } }, ctx))!.error!.code).toBe(-32602);
  });

  it('creates, searches and reads pages as Markdown', async () => {
    const created = (await call('create_page', { title: 'Tide notes', markdown: '# Tides\n\nThe **moon** drives spring tides.\n\n- neap\n- spring' })).json();
    expect(notices[0]).toMatch(/Test Client created the page “Tide notes”/);
    const hits = (await call('search_notes', { query: 'spring tides' })).json();
    expect(hits.some((h: { id: string }) => h.id === created.id)).toBe(true);
    const page = (await call('read_page', { page_id: created.id })).json();
    expect(page.markdown).toContain('**moon**');
    expect(page.markdown).toMatch(/[-*] +neap/);
  });

  it('requires approval to change an existing page and respects a refusal', async () => {
    const p = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Journal' });
    await s.pages.saveContent(p.id, docFromParagraphs(['Original line']));
    allow = false;
    const denied = await call('append_to_page', { page_id: p.id, markdown: 'Injected line' });
    expect(denied.isError).toBe(true);
    expect(approvals[0]).toMatchObject({ client: 'Test Client', action: 'append', target: 'Journal', preview: 'Injected line' });
    expect((await s.pages.get(p.id))!.content_text).not.toContain('Injected');
    allow = true;
    expect((await call('append_to_page', { page_id: p.id, markdown: 'Approved line' })).isError).toBe(false);
    const text = (await s.pages.get(p.id))!.content_text;
    expect(text).toContain('Original line');
    expect(text).toContain('Approved line');
  });

  it('cannot reach pages in other workspaces or in the trash', async () => {
    const other = (await s.workspaces.create('Private')).id;
    const secret = await s.pages.create({ workspaceId: other, title: 'Secret' });
    const secretTrashed = await s.pages.create({ workspaceId: other, title: 'Secret Trashed' });
    await s.pages.trash(secretTrashed.id);
    const live = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Live' });
    const trashed = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Gone' });
    await s.pages.trash(trashed.id);

    for (const targetId of [secret.id, trashed.id]) {
      expect((await call('read_page', { page_id: targetId })).isError).toBe(true);
      expect((await call('get_backlinks', { page_id: targetId })).isError).toBe(true);
      expect((await call('move_page', { page_id: targetId, parent_id: null })).isError).toBe(true);
      expect((await call('move_page', { page_id: live.id, parent_id: targetId })).isError).toBe(true);
      expect((await call('rename_page', { page_id: targetId, title: 'Hacked' })).isError).toBe(true);
      expect((await call('update_page', { page_id: targetId, markdown: 'Hacked' })).isError).toBe(true);
      expect((await call('trash_page', { page_id: targetId })).isError).toBe(true);
    }
    expect((await call('restore_page', { page_id: secretTrashed.id })).isError).toBe(true);
    expect((await call('restore_page', { page_id: live.id })).isError).toBe(true);
    expect((await s.pages.get(secret.id))!.title).toBe('Secret');
    expect((await s.pages.get(secretTrashed.id))!.deleted_at).not.toBeNull();
    expect((await s.pages.get(trashed.id))!.title).toBe('Gone');
  });

  it('paginates and filters list_pages by query and parent_id', async () => {
    const folder = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Folder' });
    await s.pages.create({ workspaceId: ctx.workspaceId, parentId: folder.id, title: 'Alpha Note' });
    await s.pages.create({ workspaceId: ctx.workspaceId, parentId: folder.id, title: 'Beta Note' });
    await s.pages.create({ workspaceId: ctx.workspaceId, parentId: folder.id, title: 'Gamma Note' });
    await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Other Note' });

    const page1 = (await call('list_pages', { limit: 2, offset: 0 })).json();
    expect(page1).toMatchObject({ total: 5, offset: 0, limit: 2, has_more: true });
    expect(page1.pages).toHaveLength(2);

    const page3 = (await call('list_pages', { limit: 2, offset: 4 })).json();
    expect(page3).toMatchObject({ total: 5, offset: 4, limit: 2, has_more: false });
    expect(page3.pages).toHaveLength(1);

    const byQuery = (await call('list_pages', { query: 'NOTE', limit: 2, offset: 0 })).json();
    expect(byQuery).toMatchObject({ total: 4, offset: 0, limit: 2, has_more: true });
    expect(byQuery.pages).toHaveLength(2);

    const byParent = (await call('list_pages', { parent_id: folder.id, query: 'beta' })).json();
    expect(byParent).toMatchObject({ total: 1, offset: 0, limit: 200, has_more: false });
    expect(byParent.pages.map((p: { title: string }) => p.title)).toEqual(['Beta Note']);
  });

  it('moves pages with approval, respects denial and rejects cycles', async () => {
    const a = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Parent A' });
    const b = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: a.id, title: 'Child B' });
    const c = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Target C' });

    allow = false;
    const denied = await call('move_page', { page_id: b.id, parent_id: c.id });
    expect(denied.isError).toBe(true);
    expect(approvals[0]).toMatchObject({ client: 'Test Client', action: 'move', target: 'Child B', preview: 'Move under "Target C"' });
    expect((await s.pages.get(b.id))!.parent_id).toBe(a.id);

    allow = true;
    expect((await call('move_page', { page_id: b.id, parent_id: c.id })).isError).toBe(false);
    expect((await s.pages.get(b.id))!.parent_id).toBe(c.id);
    expect(notices.at(-1)).toContain('moved');

    // Cycle: moving C under its child B, or C under itself.
    expect((await call('move_page', { page_id: c.id, parent_id: b.id })).isError).toBe(true);
    expect((await call('move_page', { page_id: c.id, parent_id: c.id })).isError).toBe(true);
    expect((await s.pages.get(c.id))!.parent_id).toBeNull();

    // Move B back to the top level.
    expect((await call('move_page', { page_id: b.id, parent_id: null })).isError).toBe(false);
    expect(approvals.at(-1)).toMatchObject({ action: 'move', target: 'Child B', preview: 'Move to the top level' });
    expect((await s.pages.get(b.id))!.parent_id).toBeNull();
  });

  it('renames pages with approval and respects denial', async () => {
    const p = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Old Name' });
    allow = false;
    expect((await call('rename_page', { page_id: p.id, title: 'New Name' })).isError).toBe(true);
    expect(approvals[0]).toMatchObject({ client: 'Test Client', action: 'rename', target: 'Old Name', preview: 'Old Name -> New Name' });
    expect((await s.pages.get(p.id))!.title).toBe('Old Name');

    allow = true;
    const ok = await call('rename_page', { page_id: p.id, title: 'New Name' });
    expect(ok.isError).toBe(false);
    expect((await s.pages.get(p.id))!.title).toBe('New Name');
    const hits = (await call('search_notes', { query: 'New Name' })).json();
    expect(hits.some((h: { id: string }) => h.id === p.id)).toBe(true);
    expect((await call('rename_page', { page_id: p.id, title: 'x'.repeat(301) })).isError).toBe(true);
  });

  it('replaces a page body with update_page and keeps search up to date', async () => {
    const p = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Field log' });
    await s.pages.saveContent(p.id, docFromParagraphs(['volcano basalt magma eruption lava']));

    allow = false;
    const denied = await call('update_page', { page_id: p.id, markdown: '# Fresh\n\ntidal estuary salt marsh heron' });
    expect(denied.isError).toBe(true);
    expect(approvals[0]).toMatchObject({ client: 'Test Client', action: 'replace', target: 'Field log', preview: '# Fresh\n\ntidal estuary salt marsh heron' });
    expect((await s.pages.get(p.id))!.content_text).toContain('volcano');

    allow = true;
    const longBody = 'tidal estuary salt marsh heron. ' + 'z'.repeat(2500);
    const updated = await call('update_page', { page_id: p.id, markdown: longBody, title: 'Estuary Notes' });
    expect(updated.isError).toBe(false);
    expect(approvals.at(-1)!.preview.length).toBe(2000);
    const saved = (await s.pages.get(p.id))!;
    expect(saved.title).toBe('Estuary Notes');
    expect(saved.content_text).not.toContain('volcano');
    expect(saved.content_text).toContain('estuary');

    const freshHits = (await call('search_notes', { query: 'estuary heron' })).json();
    expect(freshHits.some((h: { id: string }) => h.id === p.id)).toBe(true);
    const staleHits = (await call('search_notes', { query: 'volcano lava' })).json();
    expect(staleHits.some((h: { id: string }) => h.id === p.id)).toBe(false);

    expect((await call('update_page', { page_id: p.id, markdown: 'x'.repeat(200_001) })).isError).toBe(true);
  });

  it('trashes pages with approval and restores them without approval', async () => {
    const root = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Project Root' });
    await s.pages.saveContent(root.id, docFromParagraphs(['Unique kelp forest chronicle']));
    const child = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: root.id, title: 'Sub Note' });
    await s.pages.create({ workspaceId: ctx.workspaceId, parentId: child.id, title: 'Grandchild Note' });

    allow = false;
    expect((await call('trash_page', { page_id: root.id })).isError).toBe(true);
    expect(approvals[0]).toMatchObject({ client: 'Test Client', action: 'trash', target: 'Project Root' });
    expect(approvals[0].preview).toContain('2 sub-pages');
    expect((await s.pages.get(root.id))!.deleted_at).toBeNull();

    allow = true;
    const trashed = await call('trash_page', { page_id: root.id });
    expect(trashed.isError).toBe(false);
    expect(trashed.json()).toMatchObject({ id: root.id, subpages_trashed: 2 });
    // Soft-deleted only (still in database), removed from list_pages and search_notes.
    expect((await s.pages.get(root.id))!.deleted_at).not.toBeNull();
    expect((await call('list_pages')).json().pages).toEqual([]);
    expect((await call('search_notes', { query: 'kelp forest' })).json()).toEqual([]);

    // Restore needs no approval and brings the page and sub-pages back.
    const approvalCountBefore = approvals.length;
    allow = false;
    const restored = await call('restore_page', { page_id: root.id });
    expect(restored.isError).toBe(false);
    expect(approvals).toHaveLength(approvalCountBefore);
    expect((await call('list_pages')).json().total).toBe(3);
    const backHits = (await call('search_notes', { query: 'kelp forest' })).json();
    expect(backHits.some((h: { id: string }) => h.id === root.id)).toBe(true);
  });

  it('finds duplicate pages and ignores near-empty or trashed pages', async () => {
    const p1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Solar Notes' });
    const p2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: '  solar   notes ' });
    await s.pages.saveContent(p1.id, docFromParagraphs(['Photovoltaic panels convert sunlight into electricity.']));
    await s.pages.saveContent(p2.id, docFromParagraphs(['Photovoltaic panels   convert', 'sunlight into electricity.']));

    const d1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Draft One' });
    const d2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Final Copy' });
    await s.pages.saveContent(d1.id, docFromParagraphs(['Wind turbines generate electricity from moving air currents.']));
    await s.pages.saveContent(d2.id, docFromParagraphs(['Wind turbines generate electricity from moving air currents.']));

    // Near-empty pages (< 20 chars) must be ignored even if identical.
    const s1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Stub' });
    const s2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Stub' });
    await s.pages.saveContent(s1.id, docFromParagraphs(['Too short']));
    await s.pages.saveContent(s2.id, docFromParagraphs(['Too short']));

    // Trashed copy must not create a duplicate group.
    const u1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Unique' });
    const u2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Unique' });
    await s.pages.saveContent(u1.id, docFromParagraphs(['Only one live copy of this paragraph exists.']));
    await s.pages.saveContent(u2.id, docFromParagraphs(['Only one live copy of this paragraph exists.']));
    await s.pages.trash(u2.id);

    const res = (await call('find_duplicate_pages')).json();
    expect(res.total_groups).toBe(2);
    expect(res.groups).toHaveLength(2);
    const sameTitleGroup = res.groups.find((g: { same_title: boolean }) => g.same_title);
    const diffTitleGroup = res.groups.find((g: { same_title: boolean }) => !g.same_title);
    expect(sameTitleGroup).toMatchObject({ same_title: true });
    expect(sameTitleGroup.ids).toEqual(expect.arrayContaining([p1.id, p2.id]));
    expect(diffTitleGroup).toMatchObject({ same_title: false });
    expect(diffTitleGroup.ids).toEqual(expect.arrayContaining([d1.id, d2.id]));
    expect(diffTitleGroup.titles).toEqual(expect.arrayContaining(['Draft One', 'Final Copy']));
  });

  it('records agent_activity rows for all page-management actions', async () => {
    const parent = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Folder' });
    const page = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Doc' });

    expect((await call('move_page', { page_id: page.id, parent_id: parent.id })).isError).toBe(false);
    expect((await call('rename_page', { page_id: page.id, title: 'Doc Renamed' })).isError).toBe(false);
    expect((await call('update_page', { page_id: page.id, markdown: 'Updated body' })).isError).toBe(false);
    expect((await call('trash_page', { page_id: page.id })).isError).toBe(false);
    expect((await call('restore_page', { page_id: page.id })).isError).toBe(false);

    const rows = await s.activity.list(ctx.workspaceId);
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['move_page', 'rename_page', 'update_page', 'trash_page', 'restore_page']),
    );
    expect(rows.every((r) => r.client === 'Test Client' && r.page_id === page.id)).toBe(true);
  });

  it('manages tasks and validates input', async () => {
    const t = (await call('create_task', { title: 'Call the lab', due: '2030-01-15', priority: 3 })).json();
    const list = (await call('list_tasks')).json();
    expect(list).toEqual([expect.objectContaining({ id: t.id, title: 'Call the lab', priority: 3 })]);
    expect((await call('create_task', { title: 'x', due: 'not a date' })).isError).toBe(true);
    expect((await call('create_page', { title: '' })).isError).toBe(true);
  });

  it('clips web pages into "Web clips", sanitized and with the source link', async () => {
    const html = '<h2>Article</h2><p onclick="steal()">Body <b>text</b><script>alert(1)</script></p><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">bad link</a><nav>menu</nav>';
    const a = (await call('clip_web_page', { title: 'Interesting', url: 'https://example.com/post', html })).json();
    const b = (await call('clip_web_page', { title: 'Second', url: 'https://example.com/2', markdown: '# Hi' })).json();
    const pa = (await s.pages.get(a.id))!;
    const pb = (await s.pages.get(b.id))!;
    expect(pa.parent_id).toBe(pb.parent_id);
    expect((await s.pages.get(pa.parent_id!))!.title).toBe('Web clips');
    const stored = pa.content_json!;
    expect(pa.content_text).toContain('Body text');
    expect(stored).toContain('https://example.com/post');
    for (const bad of ['steal', 'alert', 'onerror', 'javascript:']) expect(stored).not.toContain(bad);
    expect((await call('clip_web_page', { title: 'x', url: 'file:///etc/passwd', html: '<p>x</p>' })).isError).toBe(true);
    expect(notices.at(-1)).toContain('Web clips');
  });

  it('recommends layered reading and documents private blocks in initialize instructions', async () => {
    const init = await handleMcp({ jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, ctx);
    const instructions = (init!.result as { instructions: string }).instructions;
    expect(instructions).toContain('detail: "index"');
    expect(instructions).toContain('outline_only');
    expect(instructions).toContain('heading');
    expect(instructions).toContain('max_chars');
    expect(instructions).toContain('<private>');
    expect(instructions).toContain('list_recent_pages');
    expect(instructions).toContain('get_page_outline_tree');
  });

  it('supports layered read_page: outline_only, heading sections, and max_chars/offset paging', async () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Preamble text before headings.' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Overview' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Overview summary text.' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Architecture' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Architecture details here.' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Storage' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'SQLite local storage.' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Testing' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Vitest and Playwright.' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Conclusion' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Final remarks.' }] },
      ],
    };
    const p = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Design Doc' });
    await s.pages.saveContent(p.id, doc);

    // Outline only: returns headings with levels and section character counts, no markdown.
    const outlined = (await call('read_page', { page_id: p.id, outline_only: true })).json();
    expect(outlined.markdown).toBeUndefined();
    expect(outlined.total_characters).toBeGreaterThan(0);
    expect(outlined.outline.map((h: { level: number; text: string }) => [h.level, h.text])).toEqual([
      [1, 'Overview'],
      [2, 'Architecture'],
      [3, 'Storage'],
      [2, 'Testing'],
      [1, 'Conclusion'],
    ]);
    for (const entry of outlined.outline) {
      expect(entry.characters).toBeGreaterThan(0);
    }

    // Heading section: case-insensitive match includes nested sub-headings and stops at same/higher level.
    const arch = (await call('read_page', { page_id: p.id, heading: '  architecture ' })).json();
    expect(arch.heading).toBe('Architecture');
    expect(arch.markdown).toContain('## Architecture');
    expect(arch.markdown).toContain('### Storage');
    expect(arch.markdown).toContain('SQLite local storage.');
    expect(arch.markdown).not.toContain('Testing');
    expect(arch.markdown).not.toContain('Conclusion');
    expect(arch.total_characters).toBe(outlined.outline[1].characters);
    expect(arch.truncated).toBe(false);
    expect(arch.next_offset).toBeNull();

    // H3 stops before sibling H2 ("Testing").
    const storage = (await call('read_page', { page_id: p.id, heading: 'STORAGE' })).json();
    expect(storage.markdown).toContain('SQLite local storage.');
    expect(storage.markdown).not.toContain('Testing');

    // Missing heading returns a recoverable tool error.
    expect((await call('read_page', { page_id: p.id, heading: 'Nonexistent' })).isError).toBe(true);

    // Paging with max_chars and offset reconstructs the full Markdown losslessly.
    const full = (await call('read_page', { page_id: p.id })).json();
    expect(full.truncated).toBe(false);
    expect(full.next_offset).toBeNull();
    expect(full.total_characters).toBe(full.markdown.length);

    let assembled = '';
    let offset: number | null = 0;
    let pagesRead = 0;
    while (offset !== null) {
      const chunk = (await call('read_page', { page_id: p.id, max_chars: 60, offset })).json();
      expect(chunk.markdown.length).toBeLessThanOrEqual(60);
      expect(chunk.total_characters).toBe(full.total_characters);
      assembled += chunk.markdown;
      offset = chunk.next_offset;
      pagesRead++;
    }
    expect(pagesRead).toBeGreaterThan(2);
    expect(assembled).toBe(full.markdown);

    // Offset past end returns empty markdown and is not truncated.
    const pastEnd = (await call('read_page', { page_id: p.id, offset: 99999 })).json();
    expect(pastEnd.markdown).toBe('');
    expect(pastEnd.truncated).toBe(false);
    expect(pastEnd.next_offset).toBeNull();

    // Very long page is capped at 100,000 chars even when max_chars is omitted or larger.
    const huge = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Huge Page' });
    await s.pages.saveContent(huge.id, docFromParagraphs(['x'.repeat(105_000)]));
    const hugeDefault = (await call('read_page', { page_id: huge.id })).json();
    expect(hugeDefault.markdown.length).toBe(100_000);
    expect(hugeDefault.total_characters).toBe(105_001);
    expect(hugeDefault.truncated).toBe(true);
    expect(hugeDefault.next_offset).toBe(100_000);
    const hugeOverCap = (await call('read_page', { page_id: huge.id, max_chars: 250_000 })).json();
    expect(hugeOverCap.markdown.length).toBe(100_000);
    const hugeTail = (await call('read_page', { page_id: huge.id, offset: hugeDefault.next_offset })).json();
    expect(hugeTail.markdown.length).toBe(5_001);
    expect(hugeTail.truncated).toBe(false);
    expect(hugeTail.next_offset).toBeNull();
  });

  it('supports search_notes detail modes ("index" and "full") and snippet_chars bounds', async () => {
    const p = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Oceanography Log' });
    const longBody =
      'Opening context about Atlantic currents and salinity measurements. '.repeat(8) +
      'Unique abyssal hydrothermal vent discovery at 3800m depth. ' +
      'Closing observations about marine sediment cores and plankton blooms. '.repeat(8);
    await s.pages.saveContent(p.id, docFromParagraphs([longBody]));

    // detail: 'index' returns id, kind and title only (no snippet).
    const idxHits = (await call('search_notes', { query: 'hydrothermal vent', detail: 'index' })).json();
    const idxHit = idxHits.find((h: { id: string }) => h.id === p.id);
    expect(idxHit).toEqual({ id: p.id, kind: 'page', title: 'Oceanography Log' });
    expect('snippet' in idxHit).toBe(false);

    // detail: 'full' with small snippet_chars bounds the snippet around the match.
    const shortHits = (await call('search_notes', { query: 'hydrothermal vent', detail: 'full', snippet_chars: 60 })).json();
    const shortHit = shortHits.find((h: { id: string }) => h.id === p.id);
    expect(shortHit.snippet.length).toBeLessThanOrEqual(60);
    expect(shortHit.snippet.toLowerCase()).toContain('hydrothermal');

    // Larger snippet_chars returns wider context up to 1000 chars.
    const wideHits = (await call('search_notes', { query: 'hydrothermal vent', snippet_chars: 400 })).json();
    const wideHit = wideHits.find((h: { id: string }) => h.id === p.id);
    expect(wideHit.snippet.length).toBeGreaterThan(200);
    expect(wideHit.snippet.length).toBeLessThanOrEqual(400);

    // Invalid detail value returns a tool error.
    expect((await call('search_notes', { query: 'hydrothermal', detail: 'compact' })).isError).toBe(true);
  });

  it('hides <private> blocks across read_page, search_notes, find_duplicate_pages and approval previews while keeping in-app search intact', async () => {
    const secretDoc: DocNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Public Section' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Visible botany notes <private>vaultcode9911</private> about ferns.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '<private>' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hidden Credentials' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'supersecretpassphrase8822' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '</private>' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Public closing <private>unterminatedsecret7733' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Trailing secret after unterminated tag' }] },
      ],
    };
    const p = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Botany Notebook' });
    await s.pages.saveContent(p.id, secretDoc);

    // 1. read_page omits inline, multi-block, private heading and unterminated private content.
    const read = (await call('read_page', { page_id: p.id })).json();
    expect(read.markdown).toContain('Visible botany notes about ferns.');
    expect(read.markdown).toContain('Public closing');
    for (const secret of ['vaultcode9911', 'Hidden Credentials', 'supersecretpassphrase8822', 'unterminatedsecret7733', 'Trailing secret', '<private>']) {
      expect(read.markdown).not.toContain(secret);
    }

    // Outline excludes private headings too.
    const outline = (await call('read_page', { page_id: p.id, outline_only: true })).json();
    expect(outline.outline.map((h: { text: string }) => h.text)).toEqual(['Public Section']);

    // 2. In-app search STILL finds private text, while MCP search_notes drops private-only hits (in both full and index detail).
    const inAppHits = await search(s.db, 'supersecretpassphrase8822', { workspaceId: ctx.workspaceId, mode: 'hybrid' });
    expect(inAppHits.some((h) => h.refId === p.id)).toBe(true);

    expect((await call('search_notes', { query: 'supersecretpassphrase8822' })).json()).toEqual([]);
    expect((await call('search_notes', { query: 'supersecretpassphrase8822', detail: 'index' })).json()).toEqual([]);
    expect((await call('search_notes', { query: 'vaultcode9911' })).json()).toEqual([]);
    expect((await call('search_notes', { query: 'unterminatedsecret7733' })).json()).toEqual([]);

    // Public word on the same page IS returned, and its snippet never leaks adjacent private text.
    const publicHits = (await call('search_notes', { query: 'botany ferns' })).json();
    const publicHit = publicHits.find((h: { id: string }) => h.id === p.id);
    expect(publicHit).toBeDefined();
    expect(publicHit.snippet).toContain('botany');
    expect(publicHit.snippet).not.toContain('vaultcode9911');
    expect(publicHit.snippet).not.toContain('supersecretpassphrase8822');

    // 3. find_duplicate_pages strips private content before comparing.
    const privDup1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Secret A' });
    const privDup2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Secret B' });
    await s.pages.saveContent(privDup1.id, docFromParagraphs(['<private>Identical private payload exceeding twenty characters.</private>']));
    await s.pages.saveContent(privDup2.id, docFromParagraphs(['<private>Identical private payload exceeding twenty characters.</private>']));

    const pubDup1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Shared Note' });
    const pubDup2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Shared Note' });
    await s.pages.saveContent(pubDup1.id, docFromParagraphs(['Public shared text exceeding twenty characters. <private>alpha secret</private>']));
    await s.pages.saveContent(pubDup2.id, docFromParagraphs(['Public shared text exceeding twenty characters. <private>beta completely different</private>']));

    const dups = (await call('find_duplicate_pages')).json();
    expect(dups.total_groups).toBe(1);
    expect(dups.groups[0].ids).toEqual(expect.arrayContaining([pubDup1.id, pubDup2.id]));
    expect(dups.groups[0].ids).not.toContain(privDup1.id);
    expect(dups.groups[0].characters).toBe('public shared text exceeding twenty characters.'.length);

    // 4. append_to_page / update_page approval previews and docPreview omit private text.
    allow = false;
    await call('append_to_page', { page_id: p.id, markdown: 'Public addendum <private>hidden append secret</private> end' });
    expect(approvals.at(-1)!.preview).toBe('Public addendum end');

    await call('update_page', { page_id: p.id, markdown: 'Public body\n<private>hidden replace secret</private>\nFooter' });
    expect(approvals.at(-1)!.preview).toBe('Public body\n\nFooter');

    expect(docPreview(secretDoc)).toContain('Visible botany notes about ferns.');
    expect(docPreview(secretDoc)).not.toContain('vaultcode9911');
    expect(docPreview(secretDoc)).not.toContain('supersecretpassphrase8822');
  });

  it('check_links reports broken links and orphans, strips private titles, isolates workspaces and caps at 200 entries', async () => {
    const linkDoc = (targetId: string): DocNode => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Ref', marks: [{ type: 'link', attrs: { href: `${PAGE_LINK_PREFIX}${targetId}` } }] }],
        },
      ],
    });

    const target = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Target <private>secret1</private>' });
    const source = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Source <private>secret2</private>' });
    await s.pages.saveContent(source.id, linkDoc(target.id));
    await s.pages.trash(target.id);

    const parent = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Folder <private>secret3</private>' });
    const orphan = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: parent.id, title: 'Orphan <private>secret4</private>' });
    await s.db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [Date.now(), parent.id]);

    // Noise in another workspace must not appear.
    const otherWs = (await s.workspaces.create('Isolated')).id;
    const otherTarget = await s.pages.create({ workspaceId: otherWs, title: 'Other Target' });
    const otherSource = await s.pages.create({ workspaceId: otherWs, title: 'Other Source' });
    await s.pages.saveContent(otherSource.id, linkDoc(otherTarget.id));
    await s.pages.trash(otherTarget.id);

    const report = (await call('check_links')).json();
    expect(report).toMatchObject({
      total_broken_links: 1,
      total_orphans: 1,
      total: 2,
      truncated: false,
    });
    expect(report.broken_links).toEqual([
      {
        source_id: source.id,
        source_title: 'Source',
        target_id: target.id,
        target_title: 'Target',
        reason: 'trashed',
      },
    ]);
    expect(report.orphans).toEqual([
      {
        id: orphan.id,
        title: 'Orphan',
        parent_id: parent.id,
        parent_title: 'Folder',
        reason: 'trashed',
      },
    ]);
    expect(JSON.stringify(report)).not.toContain('secret');

    // Cap at 200 entries total while reporting accurate total counts.
    const nowTs = Date.now();
    await s.db.transaction(async (tx) => {
      for (let i = 0; i < 205; i++) {
        const pid = `bulk-src-${i}`;
        await tx.run(
          `INSERT INTO pages(id, workspace_id, parent_id, kind, title, content_text, sort_order, created_at, updated_at)
           VALUES (?, ?, NULL, 'page', ?, '', ?, ?, ?)`,
          [pid, ctx.workspaceId, `Bulk ${i}`, i, nowTs, nowTs],
        );
        await tx.run('INSERT INTO page_links(source_id, target_id) VALUES (?, ?)', [pid, target.id]);
      }
    });

    const capped = (await call('check_links')).json();
    expect(capped.total_broken_links).toBe(206);
    expect(capped.total_orphans).toBe(1);
    expect(capped.total).toBe(207);
    expect(capped.truncated).toBe(true);
    expect(capped.broken_links.length + capped.orphans.length).toBe(200);
    expect(capped.orphans).toHaveLength(1);
    expect(capped.broken_links).toHaveLength(199);
  });

  it('list_trash paginates trashed pages, strips private titles and isolates workspaces', async () => {
    const live = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Still Live' });
    const t1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'First Trash <private>hidden</private>' });
    const t2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Second Trash' });
    const t3 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Third Trash' });
    await s.pages.create({ workspaceId: ctx.workspaceId, parentId: t3.id, title: 'Child of Third' });

    await s.pages.trash(t1.id);
    await s.pages.trash(t2.id);
    await s.pages.trash(t3.id);
    await s.db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [1_700_000_001_000, t1.id]);
    await s.db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [1_700_000_002_000, t2.id]);
    await s.db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [1_700_000_003_000, t3.id]);

    // Trashed page in another workspace must never appear.
    const otherWs = (await s.workspaces.create('Other')).id;
    const otherTrash = await s.pages.create({ workspaceId: otherWs, title: 'Secret Trash' });
    await s.pages.trash(otherTrash.id);

    const page1 = (await call('list_trash', { limit: 2, offset: 0 })).json();
    expect(page1).toMatchObject({ total: 3, offset: 0, limit: 2, has_more: true });
    expect(page1.pages.map((p: { id: string; title: string }) => [p.id, p.title])).toEqual([
      [t3.id, 'Third Trash'],
      [t2.id, 'Second Trash'],
    ]);
    expect(page1.pages[0].deleted_at).toBe(new Date(1_700_000_003_000).toISOString());

    const page2 = (await call('list_trash', { limit: 2, offset: 2 })).json();
    expect(page2).toMatchObject({ total: 3, offset: 2, limit: 2, has_more: false });
    expect(page2.pages).toEqual([
      {
        id: t1.id,
        title: 'First Trash',
        deleted_at: new Date(1_700_000_001_000).toISOString(),
      },
    ]);
    expect(JSON.stringify(page2)).not.toContain('hidden');
    expect(page1.pages.some((p: { id: string }) => p.id === live.id || p.id === otherTrash.id)).toBe(false);
  });

  it('get_backlinks lists live linking pages with clean titles and isolates workspaces', async () => {
    const target = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Hub <private>secret</private>' });
    const linkerA = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Alpha <private>key</private>' });
    const linkerB = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Beta Note' });
    const trashedLinker = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Trashed Linker' });

    await s.pages.saveContent(linkerA.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hub', marks: [{ type: 'link', attrs: { href: `${PAGE_LINK_PREFIX}${target.id}` } }] }],
        },
      ],
    });
    await s.pages.saveContent(linkerB.id, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'pageMention', attrs: { id: target.id, label: 'Hub' } }] }],
    });
    await s.pages.saveContent(trashedLinker.id, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'pageMention', attrs: { id: target.id, label: 'Hub' } }] }],
    });
    await s.pages.trash(trashedLinker.id);

    // Cross-workspace link row must not leak into backlinks.
    const otherWs = (await s.workspaces.create('Other')).id;
    const otherLinker = await s.pages.create({ workspaceId: otherWs, title: 'Foreign Linker' });
    await s.db.run('INSERT INTO page_links(source_id, target_id) VALUES (?, ?)', [otherLinker.id, target.id]);

    const res = (await call('get_backlinks', { page_id: target.id })).json();
    expect(res).toEqual({
      page_id: target.id,
      title: 'Hub',
      backlinks: [
        { id: linkerA.id, title: 'Alpha' },
        { id: linkerB.id, title: 'Beta Note' },
      ],
      total: 2,
    });
    expect(JSON.stringify(res)).not.toContain('secret');
    expect(JSON.stringify(res)).not.toContain('key');
    expect((await call('get_backlinks', { page_id: otherLinker.id })).isError).toBe(true);
    expect((await call('get_backlinks', { page_id: 'does-not-exist' })).isError).toBe(true);
  });

  it('merge_pages requires approval, respects denial, merges in order, records activity and rejects invalid inputs', async () => {
    const target = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Combined Topic' });
    await s.pages.saveContent(target.id, docFromParagraphs(['Original target intro.']));

    const srcA = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Notes Alpha <private>secret</private>' });
    await s.pages.saveContent(srcA.id, docFromParagraphs(['Alpha details <private>hidden</private> visible.']));
    const srcB = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Notes Beta' });
    await s.pages.saveContent(srcB.id, docFromParagraphs(['Beta details here.']));
    const childOfA = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: srcA.id, title: 'Sub Note' });

    const linker = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Linker' });
    await s.pages.saveContent(linker.id, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Alpha', marks: [{ type: 'link', attrs: { href: `${PAGE_LINK_PREFIX}${srcA.id}` } }] }],
        },
      ],
    });

    // Denial leaves everything unchanged and sends an approval preview with clean titles and character count.
    allow = false;
    const denied = await call('merge_pages', { target_id: target.id, source_ids: [srcA.id, srcB.id] });
    expect(denied.isError).toBe(true);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ client: 'Test Client', action: 'merge', target: 'Combined Topic' });
    expect(approvals[0].preview).toContain('Notes Alpha');
    expect(approvals[0].preview).toContain('Notes Beta');
    expect(approvals[0].preview).toMatch(/\d+ characters total/);
    expect(approvals[0].preview).not.toContain('secret');
    expect(approvals[0].preview).not.toContain('hidden');
    expect((await s.pages.get(srcA.id))!.deleted_at).toBeNull();
    expect((await s.pages.get(target.id))!.content_text).not.toContain('Beta details');

    // Validation errors fail before asking for user approval.
    const approvalsBeforeValidation = approvals.length;
    expect((await call('merge_pages', { target_id: target.id, source_ids: [] })).isError).toBe(true);
    expect(
      (await call('merge_pages', { target_id: target.id, source_ids: Array.from({ length: 21 }, (_, i) => `id-${i}`) })).isError,
    ).toBe(true);
    expect((await call('merge_pages', { target_id: target.id, source_ids: [target.id] })).isError).toBe(true);
    expect((await call('merge_pages', { target_id: childOfA.id, source_ids: [srcA.id] })).isError).toBe(true);
    const otherWs = (await s.workspaces.create('Isolated')).id;
    const foreign = await s.pages.create({ workspaceId: otherWs, title: 'Foreign' });
    expect((await call('merge_pages', { target_id: target.id, source_ids: [foreign.id] })).isError).toBe(true);
    expect(approvals).toHaveLength(approvalsBeforeValidation);

    // Approval executes the merge, re-points links, moves sub-pages, trashes sources and records activity.
    allow = true;
    const merged = await call('merge_pages', { target_id: target.id, source_ids: [srcA.id, srcB.id] });
    expect(merged.isError).toBe(false);
    expect(merged.json()).toMatchObject({
      target_id: target.id,
      target_title: 'Combined Topic',
      merged_source_ids: [srcA.id, srcB.id],
      merged_source_titles: ['Notes Alpha', 'Notes Beta'],
      moved_subpages: 1,
      redirected_pages: 1,
      redirected_links: 1,
    });

    const targetAfter = (await s.pages.get(target.id))!;
    expect(targetAfter.content_text.indexOf('Alpha details')).toBeLessThan(targetAfter.content_text.indexOf('Beta details'));
    expect((await s.pages.get(childOfA.id))!.parent_id).toBe(target.id);
    expect((await s.pages.get(srcA.id))!.deleted_at).not.toBeNull();
    expect((await s.pages.get(srcB.id))!.deleted_at).not.toBeNull();
    expect((await s.pages.get(linker.id))!.content_json).toContain(`${PAGE_LINK_PREFIX}${target.id}`);
    expect(notices.at(-1)).toContain('merged 2 pages into “Combined Topic”');

    const activityRows = await s.activity.list(ctx.workspaceId);
    expect(activityRows[0]).toMatchObject({ client: 'Test Client', action: 'merge_pages', page_id: target.id });
  });

  it('keeps read tools available when every write group is disabled', async () => {
    const p = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Readable Page' });
    await s.pages.saveContent(p.id, docFromParagraphs(['Readable content about glaciers.']));
    ctx.permissions = () => ({ create: false, modify: false, trash: false });

    expect((await call('search_notes', { query: 'glaciers' })).isError).toBe(false);
    expect((await call('list_pages')).isError).toBe(false);
    expect((await call('list_recent_pages')).isError).toBe(false);
    expect((await call('get_page_outline_tree')).isError).toBe(false);
    expect((await call('read_page', { page_id: p.id })).isError).toBe(false);
    expect((await call('find_duplicate_pages')).isError).toBe(false);
    expect((await call('check_links')).isError).toBe(false);
    expect((await call('list_trash')).isError).toBe(false);
    expect((await call('get_backlinks', { page_id: p.id })).isError).toBe(false);
    expect((await call('list_tasks')).isError).toBe(false);
    expect((await call('list_sources')).isError).toBe(false);
    expect((await call('search_sources', { query: 'glaciers' })).isError).toBe(false);
    expect(approvals).toHaveLength(0);
  });

  it('enforces MCP permissions per group without requesting approval when disabled', async () => {
    const p1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Alpha Page' });
    await s.pages.saveContent(p1.id, docFromParagraphs(['Alpha body']));
    const p2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Beta Page' });
    await s.pages.saveContent(p2.id, docFromParagraphs(['Beta body']));
    const trashed = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Trashed Page' });
    await s.pages.trash(trashed.id);

    const perms: McpPermissions = { create: false, modify: true, trash: true };
    ctx.permissions = () => perms;

    // create group disabled: create_page, create_task, clip_web_page, restore_page all fail cleanly.
    const createCalls: [string, Record<string, unknown>][] = [
      ['create_page', { title: 'Blocked Page' }],
      ['create_task', { title: 'Blocked Task' }],
      ['clip_web_page', { title: 'Blocked Clip', url: 'https://example.com', markdown: 'hi' }],
      ['restore_page', { page_id: trashed.id }],
    ];
    for (const [tool, args] of createCalls) {
      const res = await call(tool, args);
      expect(res.isError).toBe(true);
      expect(res.text).toBe(DISABLED_CAPABILITY_ERROR);
    }
    expect(approvals).toHaveLength(0);
    expect(notices).toHaveLength(0);
    expect((await s.pages.get(trashed.id))!.deleted_at).not.toBeNull();
    expect(await s.tasks.list(ctx.workspaceId)).toHaveLength(0);

    // modify group disabled: append_to_page, update_page, move_page, rename_page, merge_pages fail WITHOUT approval.
    perms.create = true;
    perms.modify = false;
    const modifyCalls: [string, Record<string, unknown>][] = [
      ['append_to_page', { page_id: p1.id, markdown: 'Appended' }],
      ['update_page', { page_id: p1.id, markdown: 'Replaced' }],
      ['move_page', { page_id: p2.id, parent_id: p1.id }],
      ['rename_page', { page_id: p1.id, title: 'Renamed' }],
      ['merge_pages', { target_id: p1.id, source_ids: [p2.id] }],
    ];
    for (const [tool, args] of modifyCalls) {
      const res = await call(tool, args);
      expect(res.isError).toBe(true);
      expect(res.text).toBe(DISABLED_CAPABILITY_ERROR);
    }
    expect(approvals).toHaveLength(0);
    expect(notices).toHaveLength(0);
    expect((await s.pages.get(p1.id))!.title).toBe('Alpha Page');
    expect((await s.pages.get(p2.id))!.parent_id).toBeNull();
    expect((await s.pages.get(p2.id))!.deleted_at).toBeNull();

    // create still works while modify is disabled.
    const created = await call('create_page', { title: 'Allowed Create' });
    expect(created.isError).toBe(false);

    // trash group disabled: trash_page fails WITHOUT approval while modify works again.
    perms.modify = true;
    perms.trash = false;
    const blockedTrash = await call('trash_page', { page_id: p2.id });
    expect(blockedTrash.isError).toBe(true);
    expect(blockedTrash.text).toBe(DISABLED_CAPABILITY_ERROR);
    expect(approvals).toHaveLength(0);
    expect((await s.pages.get(p2.id))!.deleted_at).toBeNull();

    // Enabling trash via the live getter allows trash_page (with approval).
    perms.trash = true;
    const allowedTrash = await call('trash_page', { page_id: p2.id });
    expect(allowedTrash.isError).toBe(false);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].action).toBe('trash');
    expect((await s.pages.get(p2.id))!.deleted_at).not.toBeNull();
  });

  it('marks disabled tools in tools/list descriptions without hiding them', async () => {
    const baseline = toolList();
    const perms: McpPermissions = { create: false, modify: true, trash: false };
    ctx.permissions = () => perms;

    const listRes = await handleMcp({ jsonrpc: '2.0', id: 20, method: 'tools/list' }, ctx);
    const tools = (listRes!.result as { tools: { name: string; description: string }[] }).tools;
    expect(tools).toHaveLength(baseline.length);

    const disabledNames = new Set(['create_page', 'create_task', 'clip_web_page', 'restore_page', 'trash_page']);
    for (const tool of tools) {
      const base = baseline.find((b) => b.name === tool.name)!;
      if (disabledNames.has(tool.name)) {
        expect(tool.description).toContain('Disabled in Noesis settings (Settings -> AI connections)');
        expect(tool.description).toContain(base.description);
      } else {
        expect(tool.description).toBe(base.description);
      }
    }

    // Turning trash back on removes the disabled marker on the next tools/list call.
    perms.trash = true;
    const updatedRes = await handleMcp({ jsonrpc: '2.0', id: 21, method: 'tools/list' }, ctx);
    const updatedTools = (updatedRes!.result as { tools: { name: string; description: string }[] }).tools;
    const trashTool = updatedTools.find((t) => t.name === 'trash_page')!;
    expect(trashTool.description).not.toContain('Disabled in Noesis settings');
  });

  it('defaults Prefs.mcpPermissions to all enabled and migrates missing or partial saved settings', async () => {
    expect(DEFAULT_MCP_PERMISSIONS).toEqual({ create: true, modify: true, trash: true });
    expect(DEFAULT_PREFS.mcpPermissions).toEqual({ create: true, modify: true, trash: true });

    expect(normalizeMcpPermissions(undefined)).toEqual({ create: true, modify: true, trash: true });
    expect(normalizeMcpPermissions(null)).toEqual({ create: true, modify: true, trash: true });
    expect(normalizeMcpPermissions('invalid')).toEqual({ create: true, modify: true, trash: true });
    expect(normalizeMcpPermissions({ trash: false })).toEqual({ create: true, modify: true, trash: false });
    expect(normalizeMcpPermissions({ create: false, modify: 'no', trash: 0 })).toEqual({ create: false, modify: true, trash: true });

    const prevMatchMedia = window.matchMedia;
    const prevState = useApp.getState();
    window.matchMedia = (() => ({ matches: false }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      useApp.setState({ repos: s });

      // Older saved prefs without mcpPermissions migrate cleanly to all true.
      await s.settings.set('prefs', { theme: 'light', mcpEnabled: true });
      await loadSettings();
      expect(useApp.getState().prefs.mcpPermissions).toEqual({ create: true, modify: true, trash: true });

      // Partial saved mcpPermissions preserve false values and fill missing keys with true.
      await s.settings.set('prefs', { theme: 'light', mcpPermissions: { modify: false } });
      await loadSettings();
      expect(useApp.getState().prefs.mcpPermissions).toEqual({ create: true, modify: false, trash: true });
    } finally {
      window.matchMedia = prevMatchMedia;
      useApp.setState({
        repos: prevState.repos,
        prefs: prevState.prefs,
        lang: prevState.lang,
        ai: prevState.ai,
        hasApiKey: prevState.hasApiKey,
        workspaceId: prevState.workspaceId,
      });
    }
  });

  it('invokes beforeDestructive once before mutating on approved destructive actions and skips denied, read, create, append and rename calls', async () => {
    const folder = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Folder' });
    const p1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Target Page' });
    await s.pages.saveContent(p1.id, docFromParagraphs(['Original protected body']));
    const p2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Merge Source' });
    await s.pages.saveContent(p2.id, docFromParagraphs(['Source text to merge']));
    const trashed = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Trashed Note' });
    await s.pages.trash(trashed.id);

    const hookCalls: (DestructiveActionInfo & { preMutationOk: boolean })[] = [];
    ctx.beforeDestructive = async (info) => {
      let preMutationOk = true;
      if (info.action === 'update_page') {
        preMutationOk = (await s.pages.get(p1.id))!.content_text.includes('Original protected body');
      } else if (info.action === 'move_page') {
        preMutationOk = (await s.pages.get(p1.id))!.parent_id === null;
      } else if (info.action === 'merge_pages') {
        preMutationOk = (await s.pages.get(p2.id))!.deleted_at === null;
      } else if (info.action === 'trash_page') {
        preMutationOk = (await s.pages.get(p1.id))!.deleted_at === null;
      }
      hookCalls.push({ ...info, preMutationOk });
    };

    // Read, create, restore, append and rename calls must never trigger beforeDestructive.
    expect((await call('read_page', { page_id: p1.id })).isError).toBe(false);
    expect((await call('search_notes', { query: 'Original' })).isError).toBe(false);
    expect((await call('list_pages')).isError).toBe(false);
    expect((await call('create_page', { title: 'Fresh Page', markdown: 'Hello' })).isError).toBe(false);
    expect((await call('create_task', { title: 'Fresh Task' })).isError).toBe(false);
    expect((await call('restore_page', { page_id: trashed.id })).isError).toBe(false);
    expect((await call('append_to_page', { page_id: p1.id, markdown: 'Appended line' })).isError).toBe(false);
    expect((await call('rename_page', { page_id: p1.id, title: 'Renamed Target' })).isError).toBe(false);
    expect(hookCalls).toHaveLength(0);

    // Denied destructive calls must not trigger beforeDestructive.
    allow = false;
    expect((await call('update_page', { page_id: p1.id, markdown: 'Wiped' })).isError).toBe(true);
    expect((await call('move_page', { page_id: p1.id, parent_id: folder.id })).isError).toBe(true);
    expect((await call('merge_pages', { target_id: p1.id, source_ids: [p2.id] })).isError).toBe(true);
    expect((await call('trash_page', { page_id: p1.id })).isError).toBe(true);
    expect(hookCalls).toHaveLength(0);

    // Approved destructive calls each invoke beforeDestructive once BEFORE mutating the database.
    allow = true;
    expect((await call('update_page', { page_id: p1.id, markdown: 'Replaced body' })).isError).toBe(false);
    expect(hookCalls).toEqual([{ client: 'Test Client', action: 'update_page', preMutationOk: true }]);

    expect((await call('move_page', { page_id: p1.id, parent_id: folder.id })).isError).toBe(false);
    expect((await call('merge_pages', { target_id: p1.id, source_ids: [p2.id] })).isError).toBe(false);
    expect((await call('trash_page', { page_id: p1.id })).isError).toBe(false);
    expect(hookCalls).toEqual([
      { client: 'Test Client', action: 'update_page', preMutationOk: true },
      { client: 'Test Client', action: 'move_page', preMutationOk: true },
      { client: 'Test Client', action: 'merge_pages', preMutationOk: true },
      { client: 'Test Client', action: 'trash_page', preMutationOk: true },
    ]);
  });

  it('wires SafetySnapshotThrottle through beforeDestructive so only the first destructive call per client window snapshots', async () => {
    const folder = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Archive Folder' });
    const p1 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Working Draft' });
    await s.pages.saveContent(p1.id, docFromParagraphs(['Initial draft']));

    let now = 1_700_000_000_000;
    const snapshots: string[] = [];
    const throttle = new SafetySnapshotThrottle({
      now: () => now,
      takeSnapshot: async (client) => {
        snapshots.push(client);
      },
    });
    ctx.beforeDestructive = async ({ client }) => {
      await throttle.maybeSnapshot(client);
    };

    ctx.client = 'Claude';
    expect((await call('update_page', { page_id: p1.id, markdown: 'Draft v2' })).isError).toBe(false);
    now += 5 * 60_000;
    expect((await call('move_page', { page_id: p1.id, parent_id: folder.id })).isError).toBe(false);
    expect(snapshots).toEqual(['Claude']);

    ctx.client = 'Cursor';
    expect((await call('trash_page', { page_id: p1.id })).isError).toBe(false);
    expect(snapshots).toEqual(['Claude', 'Cursor']);
  });
});
