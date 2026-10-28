import { describe, expect, it } from 'vitest';
import { memoryBlobs, memoryStore } from '../helpers';
import { recoverInterruptedSources, INTERRUPTED_SOURCE_ERROR } from '../../src/app/recover-sources';
import { IngestionPipeline, type PipelineDeps } from '../../src/ingestion/pipeline';

describe('interrupted ingestion recovery', () => {
  it('flags interrupted sources in every workspace, preserves stored data and permits retry', async () => {
    const s = await memoryStore();
    const blobs = memoryBlobs();
    const deps: PipelineDeps = { sources: s.sources, attachments: s.attachments, blobs, getProvider: async () => null, fetchUrl: async () => { throw new Error('No network expected'); } };
    const pipeline = new IngestionPipeline(deps);
    const ws = await s.workspaces.create('First');
    const other = await s.workspaces.create('Second');
    const file = await pipeline.importFile(ws.id, { name: 'retained.txt', bytes: new TextEncoder().encode('Original file retained for retry. '.repeat(10)) });
    const note = await pipeline.importText(other.id, 'Interrupted note', 'Retained note contents. '.repeat(10));
    await s.sources.setStatus(file.id, 'processing', 'extraction');
    await s.sources.setStatus(note.id, 'processing', 'embedding');
    const ready = await pipeline.importText(ws.id, 'Ready', 'Ready text');
    await s.sources.setStatus(ready.id, 'ready', 'done');
    const failed = await pipeline.importText(ws.id, 'Failed', 'Failed text');
    await s.sources.setStatus(failed.id, 'error', 'validation', 'Existing error');
    expect(await recoverInterruptedSources(s)).toBe(2);
    expect(await s.sources.get(file.id)).toMatchObject({ status: 'error', stage: 'extraction', error: INTERRUPTED_SOURCE_ERROR, attachment_id: file.attachment_id });
    expect(await s.sources.get(note.id)).toMatchObject({ status: 'error', stage: 'embedding', text_content: 'Retained note contents. '.repeat(10) });
    expect(await s.sources.get(ready.id)).toMatchObject({ status: 'ready', error: null });
    expect(await s.sources.get(failed.id)).toMatchObject({ status: 'error', error: 'Existing error' });
    expect(await recoverInterruptedSources(s)).toBe(0);
    expect(await pipeline.process(file.id)).toMatchObject({ status: 'ready', error: null });
    expect(await pipeline.process(note.id)).toMatchObject({ status: 'ready', error: null });
    await s.db.flushNow();
    await s.db.driver.close?.();
  });

  it('prevents two pipeline instances from processing the same source concurrently', async () => {
    const s = await memoryStore();
    const ws = await s.workspaces.create('Lock');
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const deps: PipelineDeps = { sources: s.sources, attachments: s.attachments, blobs: memoryBlobs(), fetchUrl: async () => { throw new Error('No network expected'); }, getProvider: async () => { calls++; enter(); await gate; return null; } };
    const first = new IngestionPipeline(deps);
    const second = new IngestionPipeline(deps);
    const src = await first.importText(ws.id, 'Concurrent', 'One active pipeline only. '.repeat(10));
    const running = first.process(src.id);
    await entered;
    expect(first.isRunning(src.id)).toBe(true);
    const duplicate = second.process(src.id).then(() => 'completed', (e: Error) => e.message);
    release();
    await running;
    expect(await duplicate).toContain('already being processed');
    expect(calls).toBe(1);
    expect(first.isRunning(src.id)).toBe(false);
    expect(second.isRunning(src.id)).toBe(false);
    await s.db.flushNow();
    await s.db.driver.close?.();
  });
});
