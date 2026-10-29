// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { handleMcp, type McpContext } from '../../src/mcp/server';
import { buildGraph, githubRepos } from '../../src/features/graph/graphData';
import { createBackup, restoreBackup } from '../../src/core/backup';
import { exportWorkspace } from '../../src/export/exporter';
import { importWorkspace } from '../../src/import/importer';
import { sha256Hex } from '../../src/lib/util';
import type { Repos } from '../../src/core/store';
import { memoryBlobs, memoryStore } from '../helpers';

async function setup() {
  const s = await memoryStore();
  const ws = (await s.workspaces.create('Agents')).id;
  const ctxFor = (client: string): McpContext => ({ repos: s, workspaceId: ws, client, approve: async () => true, notify: () => {} });
  const call = async (client: string, name: string, args: Record<string, unknown>) => {
    const res = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctxFor(client));
    const r = res!.result as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBeFalsy();
    return JSON.parse(r.content[0].text);
  };
  return { s, ws, call };
}

const nodeIds = async (s: Repos, ws: string) => (await buildGraph(s.db, ws)).nodes.map((n) => n.id);

describe('agent memory graph', () => {
  it('extracts GitHub repositories and skips site sections', () => {
    expect(
      githubRepos('See https://github.com/Rojo-Rbx/rojo.git, github.com/rojo-rbx/rojo and https://github.com/trending?since=daily or github.com/orgs/x and github.com/a/b.'),
    ).toEqual(['rojo-rbx/rojo', 'a/b']);
  });

  it('records which client wrote each page and shows clients as graph nodes', async () => {
    const { s, ws, call } = await setup();
    const a = await call('Claude Code', 'create_page', { title: 'Tides', markdown: 'Moon and tides.' });
    await call('Codex', 'append_to_page', { page_id: a.id, markdown: 'More from Codex.' });
    await call('Codex', 'create_task', { title: 'Check tide tables' });

    const log = await s.activity.list(ws);
    expect(log.map((x) => [x.client, x.action]).sort()).toEqual([
      ['Claude Code', 'create_page'],
      ['Codex', 'append_to_page'],
      ['Codex', 'create_task'],
    ]);

    const g = await buildGraph(s.db, ws);
    const agents = g.nodes.filter((n) => n.kind === 'agent').map((n) => n.refId).sort();
    expect(agents).toEqual(['Claude Code', 'Codex']);
    const toPage = g.edges.filter((e) => e.kind === 'agent' && e.target === `page:${a.id}`).map((e) => e.source).sort();
    expect(toPage).toEqual(['agent:Claude Code', 'agent:Codex']);
  });

  it('joins pages that mention the same repository and drops trashed pages', async () => {
    const { s, ws, call } = await setup();
    const one = await call('Claude Code', 'create_page', { title: 'Reel A', markdown: 'Repo: [rojo](https://github.com/rojo-rbx/rojo)' });
    const two = await call('Claude Code', 'create_page', { title: 'Reel B', markdown: 'Also https://github.com/rojo-rbx/rojo/releases' });
    const g = await buildGraph(s.db, ws);
    const repo = g.nodes.find((n) => n.id === 'repo:rojo-rbx/rojo')!;
    expect(repo.degree).toBe(2);
    expect(g.edges.filter((e) => e.target === repo.id).map((e) => e.source).sort()).toEqual([`page:${one.id}`, `page:${two.id}`].sort());

    await s.pages.trash(one.id);
    await s.pages.trash(two.id);
    const after = await nodeIds(s, ws);
    expect(after).not.toContain('repo:rojo-rbx/rojo');
    expect(after).not.toContain('agent:Claude Code');
  });

  it('keeps agent activity through backup restore and still restores backups made before it existed', async () => {
    const { s, ws, call } = await setup();
    await call('Claude Code', 'create_page', { title: 'Kept', markdown: 'x' });
    const backup = await createBackup(s.db, null);

    const target = await memoryStore();
    await restoreBackup(target.db, backup, null);
    expect((await target.activity.list(ws)).map((x) => x.client)).toEqual(['Claude Code']);

    // Rebuild the same archive as an older app would have written it: schema 5, no agent_activity.
    const zip = await JSZip.loadAsync(backup);
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    const data = JSON.parse(await zip.file('data.json')!.async('string'));
    delete data.agent_activity;
    delete manifest.tables.agent_activity;
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    zip.file('data.json', bytes);
    zip.file('manifest.json', JSON.stringify({ ...manifest, schemaVersion: 5, dataSha256: await sha256Hex(bytes) }));
    const old = await memoryStore();
    await restoreBackup(old.db, await zip.generateAsync({ type: 'uint8array' }), null);
    expect(await old.pages.listTree(ws)).toHaveLength(1);
    expect(await old.activity.list(ws)).toEqual([]);
  });

  it('round-trips agent activity through a workspace export and import', async () => {
    const { s, ws, call } = await setup();
    await call('Codex', 'create_page', { title: 'Exported note', markdown: 'body' });
    await call('Codex', 'create_task', { title: 'Exported task' });
    const zip = await exportWorkspace(s, ws, memoryBlobs());

    const b = await memoryStore();
    const wsB = (await b.workspaces.create('Imported')).id;
    await importWorkspace(b, wsB, [{ path: 'export.zip', bytes: zip.bytes }], { blobs: memoryBlobs(), rootTitle: () => 'Imported' });
    const log = await b.activity.list(wsB);
    expect(log.map((x) => x.action).sort()).toEqual(['create_page', 'create_task']);
    expect(log.every((x) => x.client === 'Codex')).toBe(true);
    const page = (await b.pages.listTree(wsB)).find((p) => p.title === 'Exported note')!;
    expect(log.find((x) => x.action === 'create_page')!.page_id).toBe(page.id);
  });
});
