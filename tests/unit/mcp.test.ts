// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { docFromParagraphs } from '../../src/core/doc';
import { handleMcp, type ApprovalRequest, type McpContext } from '../../src/mcp/server';
import { formatApprovalBody, formatApprovalPreview } from '../../src/features/mcp/McpApprovalDialog';
import { translate } from '../../src/i18n';
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
    expect(approvals[0]).toMatchObject({
      client: 'Test Client',
      action: 'move',
      target: 'Child B',
      preview: 'Move under "Target C"',
      detail: { kind: 'move', parent: 'Target C' },
    });
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
    expect(approvals.at(-1)).toMatchObject({
      action: 'move',
      target: 'Child B',
      preview: 'Move to the top level',
      detail: { kind: 'move', parent: null },
    });
    expect((await s.pages.get(b.id))!.parent_id).toBeNull();
  });

  it('renames pages with approval and respects denial', async () => {
    const p = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Old Name' });
    allow = false;
    expect((await call('rename_page', { page_id: p.id, title: 'New Name' })).isError).toBe(true);
    expect(approvals[0]).toMatchObject({
      client: 'Test Client',
      action: 'rename',
      target: 'Old Name',
      preview: 'Old Name -> New Name',
      detail: { kind: 'rename', from: 'Old Name', to: 'New Name' },
    });
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
    expect(approvals[0]).toMatchObject({
      client: 'Test Client',
      action: 'replace',
      target: 'Field log',
      preview: '# Fresh\n\ntidal estuary salt marsh heron',
      detail: { kind: 'replace', body: '# Fresh\n\ntidal estuary salt marsh heron' },
    });
    expect((await s.pages.get(p.id))!.content_text).toContain('volcano');

    allow = true;
    const longBody = 'tidal estuary salt marsh heron. ' + 'z'.repeat(2500);
    const updated = await call('update_page', { page_id: p.id, markdown: longBody, title: 'Estuary Notes' });
    expect(updated.isError).toBe(false);
    expect(approvals.at(-1)!.preview.length).toBe(2000);
    expect(approvals.at(-1)!.preview).toContain('Title: Field log -> Estuary Notes');
    expect(approvals.at(-1)!.detail).toMatchObject({
      kind: 'replace',
      titleFrom: 'Field log',
      titleTo: 'Estuary Notes',
    });
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

  it('calls beforePageReplace, writes the page, then calls afterPageReplace in order', async () => {
    const p = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Live Doc' });
    await s.pages.saveContent(p.id, docFromParagraphs(['old body']));
    const events: string[] = [];
    const origSave = s.pages.saveContent.bind(s.pages);
    s.pages.saveContent = async (id, doc, title) => {
      events.push(`write:${id}`);
      return origSave(id, doc, title);
    };
    ctx.beforePageReplace = async (id) => {
      events.push(`before:${id}`);
    };
    ctx.afterPageReplace = (id) => {
      events.push(`after:${id}`);
    };

    allow = false;
    expect((await call('update_page', { page_id: p.id, markdown: 'blocked' })).isError).toBe(true);
    expect(events).toEqual([]);

    allow = true;
    expect((await call('update_page', { page_id: p.id, markdown: 'replaced body' })).isError).toBe(false);
    expect(events).toEqual([`before:${p.id}`, `write:${p.id}`, `after:${p.id}`]);
  });

  it('revalidates live pages and cycles after approval before mutating', async () => {
    const origin = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Origin' });
    const doc = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: origin.id, title: 'Doc' });
    const dest = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Dest' });

    // Destination trashed while approval is pending: move_page must fail and leave doc where it was.
    ctx.approve = async () => {
      await s.pages.trash(dest.id);
      return true;
    };
    expect((await call('move_page', { page_id: doc.id, parent_id: dest.id })).isError).toBe(true);
    expect((await s.pages.get(doc.id))!.parent_id).toBe(origin.id);

    // Cycle formed concurrently while approval is pending: move_page must fail.
    const dest2 = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Dest 2' });
    ctx.approve = async () => {
      await s.pages.move(dest2.id, doc.id);
      return true;
    };
    expect((await call('move_page', { page_id: doc.id, parent_id: dest2.id })).isError).toBe(true);
    expect((await s.pages.get(doc.id))!.parent_id).toBe(origin.id);

    // Target trashed while approval is pending: every mutating tool must fail without mutating.
    for (const [tool, extra] of [
      ['update_page', { markdown: 'stale' }],
      ['rename_page', { title: 'Stale' }],
      ['trash_page', {}],
      ['append_to_page', { markdown: 'stale' }],
    ] as const) {
      const live = await s.pages.create({ workspaceId: ctx.workspaceId, title: `Live-${tool}` });
      ctx.approve = async () => {
        await s.pages.trash(live.id);
        return true;
      };
      expect((await call(tool, { page_id: live.id, ...extra })).isError).toBe(true);
      expect((await s.pages.get(live.id))!.title).toBe(`Live-${tool}`);
    }
  });

  it('formats localized English and Turkish approval bodies and previews with pluralization and fallback', () => {
    const enT = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);
    const trT = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('tr', k, v);

    const moveUnder: ApprovalRequest = {
      client: 'Claude',
      action: 'move',
      target: 'Note',
      preview: 'Move under "Folder"',
      detail: { kind: 'move', parent: 'Folder' },
    };
    expect(formatApprovalPreview(moveUnder, enT)).toBe('Move under “Folder”');
    expect(formatApprovalPreview(moveUnder, trT)).toBe('“Folder” sayfasının altına taşı');

    const moveRoot: ApprovalRequest = {
      client: 'Claude',
      action: 'move',
      target: 'Note',
      preview: 'Move to the top level',
      detail: { kind: 'move', parent: null },
    };
    expect(formatApprovalPreview(moveRoot, enT)).toBe('Move to the top level');
    expect(formatApprovalPreview(moveRoot, trT)).toBe('Üst düzeye taşı');

    const renameReq: ApprovalRequest = {
      client: 'Claude',
      action: 'rename',
      target: 'Old',
      preview: 'Old -> New',
      detail: { kind: 'rename', from: 'Old', to: 'New' },
    };
    expect(formatApprovalPreview(renameReq, enT)).toBe('Rename “Old” to “New”');
    expect(formatApprovalPreview(renameReq, trT)).toBe('“Old” adını “New” olarak değiştir');

    const trash0: ApprovalRequest = { client: 'Claude', action: 'trash', target: 'P', preview: 'fallback', detail: { kind: 'trash', subpages: 0 } };
    const trash1: ApprovalRequest = { client: 'Claude', action: 'trash', target: 'P', preview: 'fallback', detail: { kind: 'trash', subpages: 1 } };
    const trash2: ApprovalRequest = { client: 'Claude', action: 'trash', target: 'P', preview: 'fallback', detail: { kind: 'trash', subpages: 2 } };
    expect(formatApprovalPreview(trash0, enT)).toBe('Move “P” to the trash (0 sub-pages).');
    expect(formatApprovalPreview(trash1, enT)).toBe('Move “P” and 1 sub-page to the trash.');
    expect(formatApprovalPreview(trash2, enT)).toBe('Move “P” and 2 sub-pages to the trash.');
    expect(formatApprovalPreview(trash0, trT)).toBe('“P” sayfasını çöpe taşı (0 alt sayfa).');
    expect(formatApprovalPreview(trash1, trT)).toBe('“P” sayfasını ve 1 alt sayfayı çöpe taşı.');
    expect(formatApprovalPreview(trash2, trT)).toBe('“P” sayfasını ve 2 alt sayfayı çöpe taşı.');

    const replaceTitle: ApprovalRequest = {
      client: 'Claude',
      action: 'replace',
      target: 'Old',
      preview: 'Title: Old -> New\n\nBody',
      detail: { kind: 'replace', titleFrom: 'Old', titleTo: 'New', body: 'Body' },
    };
    expect(formatApprovalBody(replaceTitle, enT)).toContain('rename it to “New”');
    expect(formatApprovalBody(replaceTitle, trT)).toContain('“New”');
    expect(formatApprovalPreview(replaceTitle, enT)).toBe('Title: Old -> New\n\nBody');
    expect(formatApprovalPreview(replaceTitle, trT)).toBe('Başlık: Old -> New\n\nBody');

    const legacy: ApprovalRequest = { client: 'Claude', action: 'move', target: 'Note', preview: 'Legacy preview' };
    expect(formatApprovalPreview(legacy, trT)).toBe('Legacy preview');
  });

  it('trashes pages with approval and restores them without approval', async () => {
    const root = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Project Root' });
    await s.pages.saveContent(root.id, docFromParagraphs(['Unique kelp forest chronicle']));
    const child = await s.pages.create({ workspaceId: ctx.workspaceId, parentId: root.id, title: 'Sub Note' });
    await s.pages.create({ workspaceId: ctx.workspaceId, parentId: child.id, title: 'Grandchild Note' });

    allow = false;
    expect((await call('trash_page', { page_id: root.id })).isError).toBe(true);
    expect(approvals[0]).toMatchObject({
      client: 'Test Client',
      action: 'trash',
      target: 'Project Root',
      detail: { kind: 'trash', subpages: 2 },
    });
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
});
