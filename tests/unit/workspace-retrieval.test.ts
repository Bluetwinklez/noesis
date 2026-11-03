import { describe, expect, it } from 'vitest';
import { memoryStore } from '../helpers';
import { docFromParagraphs } from '../../src/core/doc';
import { answerWorkspaceQuestion, rankWorkspaceEvidence, retrieveWorkspaceEvidence } from '../../src/ai/workspace-retrieval';
import { DEFAULT_AI_CONFIG, type AiProvider } from '../../src/ai/types';

describe('workspace evidence retrieval', () => {
  it('ranks relevant passages and omits unrelated hash collisions', () => {
    const base = { kind: 'page' as const, title: 'Notes', start: 0, end: 20, pageNumber: null };
    const results = rankWorkspaceEvidence('glacier basalt', [
      { ...base, id: 'unrelated', text: 'A warm ocean is blue.' },
      { ...base, id: 'partial', text: 'A glacier moves slowly.' },
      { ...base, id: 'complete', text: 'Glacier basalt records erosion.' },
    ]);
    expect(results[0].id).toBe('complete');
    expect(results.some((item) => item.id === 'unrelated')).toBe(false);
  });

  it('retrieves pages and notebook sources from the selected workspace only', async () => {
    const repos = await memoryStore();
    const ws = await repos.workspaces.create('Research');
    const other = await repos.workspaces.create('Private');
    const page = await repos.pages.create({ workspaceId: ws.id, title: 'Field notes', content: docFromParagraphs(['Glacier basalt evidence on this page.']) });
    await repos.pages.create({ workspaceId: other.id, title: 'Secret', content: docFromParagraphs(['Glacier basalt secret.']) });
    const source = await repos.sources.create({ workspaceId: ws.id, title: 'Paper', kind: 'note', origin: 'pasted' });
    await repos.sources.replaceChunks(source.id, [{ text: 'Glacier basalt evidence from a source.', pageNumber: 3, charStart: 0, charEnd: 38, embedding: null }], null);
    await repos.sources.setStatus(source.id, 'ready', 'done');
    const notebook = await repos.notebooks.create(ws.id, 'Notebook');
    await repos.notebooks.addSource(notebook.id, source.id);
    const results = await retrieveWorkspaceEvidence(repos.db, ws.id, 'glacier basalt');
    expect(results.some((item) => item.kind === 'page' && item.id === page.id)).toBe(true);
    expect(results.some((item) => item.kind === 'source' && item.id === source.id && item.pageNumber === 3)).toBe(true);
    expect(results.some((item) => item.title === 'Secret')).toBe(false);
  });

  it('uses mock provider citations and refuses without retrieval', async () => {
    const repos = await memoryStore();
    const ws = await repos.workspaces.create('Mock');
    const page = await repos.pages.create({ workspaceId: ws.id, title: 'Evidence', content: docFromParagraphs(['Glacier basalt reveals erosion.']) });
    let calls = 0;
    const provider: AiProvider = { id: 'custom', label: 'Mock', config: DEFAULT_AI_CONFIG, isCloud: false,
      capabilities: { chat: true, embeddings: false, tts: false, multiSpeakerTts: false, transcription: false, vision: false },
      async chat(request) { calls++; expect(request.system).toContain('untrusted DATA'); return 'Glacier basalt reveals erosion [1]. Invalid [9].'; } };
    const result = await answerWorkspaceQuestion(repos.db, ws.id, provider, 'glacier basalt', 'en');
    expect(result.insufficient).toBe(false);
    expect(result.citations[0].sourceId).toBe(page.id);
    expect(result.text).not.toContain('[9]');
    const missing = await answerWorkspaceQuestion(repos.db, ws.id, provider, 'quasarxylophone987', 'en');
    expect(missing.insufficient).toBe(true);
    expect(calls).toBe(1);
  });
});
