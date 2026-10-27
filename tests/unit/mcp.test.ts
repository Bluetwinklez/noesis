// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '../../src/core/store';
import { docFromParagraphs } from '../../src/core/doc';
import { handleMcp, type ApprovalRequest, type McpContext } from '../../src/mcp/server';
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
    const names = (list!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search_notes', 'read_page', 'create_page', 'append_to_page', 'list_tasks', 'create_task', 'search_sources']));
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
    expect((await call('read_page', { page_id: secret.id })).isError).toBe(true);
    const trashed = await s.pages.create({ workspaceId: ctx.workspaceId, title: 'Gone' });
    await s.pages.trash(trashed.id);
    expect((await call('read_page', { page_id: trashed.id })).isError).toBe(true);
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
