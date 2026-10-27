import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createProvider, pcmToWav, readSse, toAiError } from '../../src/ai/providers';
import { AiError, DEFAULT_AI_CONFIG, PROVIDER_DEFAULTS } from '../../src/ai/types';
import { extractJson } from '../../src/ai/assistant';
import { createBackup, inspectBackup, restoreBackup } from '../../src/core/backup';
import { docFromParagraphs } from '../../src/core/doc';
import { search } from '../../src/search/search';
import { memoryBlobs, memoryStore } from '../helpers';
import { safeFileName } from '../../src/lib/util';

const cfg = (p: 'openai' | 'gemini' | 'anthropic') => ({ ...DEFAULT_AI_CONFIG, ...PROVIDER_DEFAULTS[p], provider: p });

describe('AI provider failures', () => {
  it('maps an invalid API key to a recoverable auth error and redacts secrets', async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-abcdefghijklmnop' } }), { status: 401 });
    const p = createProvider(cfg('openai'), 'sk-bad', fetchFn)!;
    const err = await p.chat({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('auth');
    expect(err.recoverable).toBe(true);
    expect(err.message).not.toContain('sk-abcdefghijklmnop');
  });

  it('reports network failures, rate limits and cancellation distinctly', async () => {
    const offline = createProvider(cfg('gemini'), 'k', async () => {
      throw new TypeError('Failed to fetch');
    })!;
    expect((await offline.chat({ messages: [{ role: 'user', content: 'x' }] }).catch((e) => e)).code).toBe('network');
    const limited = createProvider(cfg('anthropic'), 'k', async () => new Response('{}', { status: 429 }))!;
    expect((await limited.chat({ messages: [{ role: 'user', content: 'x' }] }).catch((e) => e)).code).toBe('rate_limit');
    const ctrl = new AbortController();
    ctrl.abort();
    const cancelled = createProvider(cfg('openai'), 'k', async (_u, init) => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response('{}');
    })!;
    expect((await cancelled.chat({ messages: [{ role: 'user', content: 'x' }], signal: ctrl.signal }).catch((e) => e)).code).toBe('cancelled');
  });

  it('requires a key before calling cloud providers', async () => {
    for (const id of ['openai', 'gemini', 'anthropic'] as const) {
      const p = createProvider(cfg(id), null, async () => new Response('{}'))!;
      expect((await p.chat({ messages: [{ role: 'user', content: 'x' }] }).catch((e) => e)).code).toBe('not_configured');
    }
  });

  it('streams OpenAI-style SSE tokens', async () => {
    const body = ['data: {"choices":[{"delta":{"content":"Mer"}}]}', 'data: {"choices":[{"delta":{"content":"haba"}}]}', 'data: [DONE]', ''].join('\n');
    const p = createProvider(cfg('openai'), 'k', async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))!;
    const tokens: string[] = [];
    expect(await p.chat({ messages: [{ role: 'user', content: 'x' }], onToken: (t) => tokens.push(t) })).toBe('Merhaba');
    expect(tokens).toEqual(['Mer', 'haba']);
  });

  it('streams Gemini and Anthropic responses', async () => {
    const g = createProvider(cfg('gemini'), 'k', async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n'))!;
    expect(await g.chat({ messages: [{ role: 'user', content: 'x' }], onToken: () => {} })).toBe('Hi');
    const a = createProvider(cfg('anthropic'), 'k', async () =>
      new Response('event: x\ndata: {"type":"content_block_delta","delta":{"text":"Yo"}}\n\ndata: {"type":"message_stop"}\n'),
    )!;
    expect(await a.chat({ messages: [{ role: 'user', content: 'x' }], onToken: () => {} })).toBe('Yo');
  });

  it('parses SSE split across chunks', async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('data: {"a"'));
        c.enqueue(enc.encode(':1}\n\ndata: two\n'));
        c.close();
      },
    });
    const out: string[] = [];
    for await (const d of readSse(new Response(stream))) out.push(d);
    expect(out).toEqual(['{"a":1}', 'two']);
  });

  it('builds valid WAV headers and extracts JSON from fenced replies', async () => {
    const wav = pcmToWav(new Uint8Array(480), 24000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(480);
    expect(extractJson<{ a: number }>('Sure!\n```json\n{"a": 2}\n```')).toEqual({ a: 2 });
    expect(() => extractJson('no json here')).toThrow(AiError);
    expect((await toAiError(new Response('x', { status: 503 }), 'P')).code).toBe('server');
  });
});

describe('backup and restore', () => {
  it('round-trips all data and attachments, rebuilding search', async () => {
    const s = await memoryStore();
    const blobs = memoryBlobs();
    const ws = await s.workspaces.create('Backup me');
    const p = await s.pages.create({ workspaceId: ws.id, title: 'Diary', content: docFromParagraphs(['unique zebra content']) });
    const key = await blobs.put('file.txt', new TextEncoder().encode('attachment bytes'));
    await s.attachments.create({ workspace_id: ws.id, file_name: 'file.txt', mime: 'text/plain', size: 16, storage_key: key, sha256: null });
    const d = await s.databases.createDatabase(ws.id, 'DB');
    await s.databases.addRow(d.id, {});
    await s.tasks.create({ workspaceId: ws.id, title: 'Task one' });
    const bytes = await createBackup(s.db, blobs);

    const target = await memoryStore();
    const tblobs = memoryBlobs();
    await target.workspaces.create('Will be replaced');
    const manifest = await restoreBackup(target.db, bytes, tblobs);
    expect(manifest.tables.pages).toBe(2);
    const wss = await target.workspaces.list();
    expect(wss.map((w) => w.name)).toEqual(['Backup me']);
    expect((await target.pages.get(p.id))?.content_text).toBe('unique zebra content');
    const hits = await search(target.db, 'zebra', { workspaceId: ws.id, mode: 'fulltext' });
    expect(hits.some((h) => h.refId === p.id)).toBe(true);
    const [att] = await target.attachments.list(ws.id);
    expect(new TextDecoder().decode(await tblobs.get(att.storage_key))).toBe('attachment bytes');
  });

  it('detects corrupted or foreign archives and leaves data untouched', async () => {
    const s = await memoryStore();
    const ws = await s.workspaces.create('Keep');
    await expect(restoreBackup(s.db, new Uint8Array([1, 2, 3]), null)).rejects.toThrow(/not a valid/);
    const good = await createBackup(s.db, null);
    const zip = await JSZip.loadAsync(good);
    const data = JSON.parse(await zip.file('data.json')!.async('string'));
    data.workspaces[0].name = 'tampered';
    zip.file('data.json', JSON.stringify(data));
    const tampered = await zip.generateAsync({ type: 'uint8array' });
    await expect(inspectBackup(tampered)).rejects.toThrow(/checksum/);
    await expect(restoreBackup(s.db, tampered, null)).rejects.toThrow();
    expect((await s.workspaces.list())[0].id).toBe(ws.id);
  });
});

describe('utilities', () => {
  it('sanitises Windows file names', () => {
    expect(safeFileName('a<b>:c?.md')).toBe('a_b__c_.md');
    expect(safeFileName('CON.txt')).toBe('_CON.txt');
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
  });
});
