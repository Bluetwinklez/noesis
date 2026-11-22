// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { docFromParagraphs, type DocNode } from '../../src/core/doc';
import { search } from '../../src/search/search';
import { docPreview, handleMcp, type ApprovalRequest, type McpContext } from '../../src/mcp/server';
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
        'read_page',
        'create_page',
        'append_to_page',
        'update_page',
        'move_page',
        'rename_page',
        'trash_page',
        'restore_page',
        'find_duplicate_pages',
        'list_tasks',
        'create_task',
        'search_sources',
      ]),
    );
    expect(tools.find((t) => t.name === 'trash_page')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'update_page')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'find_duplicate_pages')?.annotations?.readOnlyHint).toBe(true);
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
});
