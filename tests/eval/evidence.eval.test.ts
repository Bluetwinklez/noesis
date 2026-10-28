import { describe, expect, it } from 'vitest';
import { answerQuestion } from '../../src/ai/rag';
import { createProvider } from '../../src/ai/providers';
import { AiError, DEFAULT_AI_CONFIG, PROVIDER_DEFAULTS, type AiProvider, type ProviderId } from '../../src/ai/types';
import { chunkPages } from '../../src/ingestion/chunker';
import { localHashEmbed, LOCAL_EMBED_MODEL } from '../../src/search/vectors';
import { memoryStore } from '../helpers';
import { evidenceCases, type EvidenceCase } from './cases';
import { scoreEvidence } from './scoring';

const key = process.env.NOESIS_EVAL_API_KEY;
const mode = process.env.NOESIS_EVAL_PROVIDER ?? (key ? 'openai' : 'mock');
function providerFor(test: EvidenceCase): AiProvider {
  if (mode === 'mock') return { id: 'custom', label: 'Deterministic evaluation mock', config: DEFAULT_AI_CONFIG, isCloud: false,
    capabilities: { chat: true, embeddings: false, tts: false, multiSpeakerTts: false, transcription: false, vision: false }, async chat() { return test.mockReply; } };
  if (!['openai', 'gemini', 'anthropic', 'ollama', 'custom'].includes(mode)) throw new Error('Unknown NOESIS_EVAL_PROVIDER.');
  const id = mode as Exclude<ProviderId, 'none'>;
  const defaults = PROVIDER_DEFAULTS[id];
  const provider = createProvider({ ...DEFAULT_AI_CONFIG, ...defaults, provider: id, embeddingModel: '',
    ...(process.env.NOESIS_EVAL_BASE_URL ? { baseUrl: process.env.NOESIS_EVAL_BASE_URL } : {}),
    ...(process.env.NOESIS_EVAL_CHAT_MODEL ? { chatModel: process.env.NOESIS_EVAL_CHAT_MODEL } : {}),
  }, key ?? null);
  if (!provider) throw new Error('The evaluation provider could not be configured.');
  return provider;
}

describe(`source-grounded evidence evaluation (${mode})`, () => {
  it.each(evidenceCases)('$id', async (test) => {
    const store = await memoryStore();
    try {
      const ws = await store.workspaces.create('Synthetic evidence evaluation');
      const source = await store.sources.create({ workspaceId: ws.id, title: test.id, kind: 'note', origin: 'synthetic-eval' });
      const { fullText, chunks } = chunkPages([{ pageNumber: 1, text: test.source }]);
      await store.sources.setExtracted(source.id, fullText, 1, {});
      await store.sources.replaceChunks(source.id, chunks.map((c) => ({ ...c, embedding: localHashEmbed(c.text) })), LOCAL_EMBED_MODEL);
      await store.sources.setStatus(source.id, 'ready', 'done');
      let answer;
      try { answer = await answerQuestion(store.db, providerFor(test), test.question, { sourceIds: [source.id], history: [], lang: test.lang, signal: AbortSignal.timeout(60_000) }); }
      catch (e) { throw new Error(`Evaluation request failed for ${mode}: ${e instanceof AiError ? e.code : 'provider/configuration error'}. Request and credential details are not logged.`); }
      expect(scoreEvidence(test, answer)).toEqual({ answerCorrect: true, citationPresent: true, citationSupported: true, refusalCorrect: true });
    } finally { await store.db.driver.close?.(); }
  });
});
