import type { AttachmentRepo, SourceRepo } from '../core/repos/research';
import type { PipelineStage, Source, SourceKind } from '../core/types';
import type { AiProvider } from '../ai/types';
import { AiError } from '../ai/types';
import { toBase64 } from '../ai/providers';
import { localHashEmbed, LOCAL_EMBED_MODEL } from '../search/vectors';
import { sha256Hex } from '../lib/util';
import { chunkPages, normalizeText, type PageText } from './chunker';
import {
  detectKind,
  extractCsv,
  extractDocx,
  extractHtml,
  extractMarkdown,
  extractPdf,
  extractPlainText,
  htmlToText,
  IngestionError,
  isYouTubeUrl,
  validateBytes,
  validateUrl,
  type ExtractResult,
} from './extractors';

export interface PipelineDeps {
  sources: SourceRepo;
  attachments: AttachmentRepo;
  blobs: { put(name: string, bytes: Uint8Array): Promise<string>; get(key: string): Promise<Uint8Array> };
  /** Returns the provider only if the user consented to sending content to it. */
  getProvider: (purpose: 'embeddings' | 'ocr' | 'transcription') => Promise<AiProvider | null>;
  fetchUrl: (url: string, signal?: AbortSignal) => Promise<Response>;
  /** Offline OCR (Tesseract in the app). Absent in tests/Node: AI vision is used instead. */
  ocr?: {
    image(bytes: Uint8Array, mime: string, signal: AbortSignal): Promise<string>;
    pdf(bytes: Uint8Array, signal: AbortSignal): Promise<{ pageNumber: number; text: string }[]>;
  };
  onProgress?: (sourceId: string, stage: PipelineStage, detail?: string) => void;
}

export interface FileInput {
  name: string;
  bytes: Uint8Array;
  mime?: string;
}

const STAGES: PipelineStage[] = ['import', 'validation', 'extraction', 'normalization', 'chunking', 'embedding', 'indexing', 'done'];
export const stageIndex = (s: PipelineStage) => STAGES.indexOf(s);

/** Ingestion pipeline: Import → Validation → Extraction → Normalization → Chunking → Embedding → Indexing. */
export class IngestionPipeline {
  private running = new Map<string, AbortController>();

  constructor(private deps: PipelineDeps) {}

  cancel(sourceId: string) {
    this.running.get(sourceId)?.abort();
  }

  isRunning(sourceId: string) {
    return this.running.has(sourceId);
  }

  /** Registers a file as a source and stores the original bytes. Does not process it. */
  async importFile(workspaceId: string, file: FileInput): Promise<Source> {
    const kind = detectKind(file.name);
    const source = await this.deps.sources.create({
      workspaceId,
      title: file.name.replace(/\.[^.]+$/, ''),
      kind: kind ?? 'txt',
      origin: file.name,
      mime: file.mime ?? '',
      size: file.bytes.byteLength,
    });
    if (!kind) {
      await this.deps.sources.setStatus(source.id, 'error', 'validation', `Unsupported file type: ${file.name.split('.').pop() || 'unknown'}.`);
      return (await this.deps.sources.get(source.id))!;
    }
    try {
      const key = await this.deps.blobs.put(file.name, file.bytes);
      const att = await this.deps.attachments.create({
        workspace_id: workspaceId,
        file_name: file.name,
        mime: file.mime || 'application/octet-stream',
        size: file.bytes.byteLength,
        storage_key: key,
        sha256: await sha256Hex(file.bytes),
      });
      await this.deps.sources.setAttachment(source.id, att.id);
    } catch (e) {
      await this.deps.sources.setStatus(source.id, 'error', 'import', `Could not store the file: ${(e as Error).message}`);
    }
    return (await this.deps.sources.get(source.id))!;
  }

  async importUrl(workspaceId: string, url: string): Promise<Source> {
    const kind: SourceKind = isYouTubeUrl(url) ? 'youtube' : 'url';
    return this.deps.sources.create({ workspaceId, title: url, kind, origin: url.trim() });
  }

  async importText(workspaceId: string, title: string, text: string): Promise<Source> {
    const s = await this.deps.sources.create({ workspaceId, title: title || 'Pasted text', kind: 'note', origin: 'pasted' });
    await this.deps.sources.setExtracted(s.id, text, null, {});
    return s;
  }

  /** Runs (or re-runs) all stages. Never reports success on failure. */
  async process(sourceId: string): Promise<Source> {
    if (this.running.has(sourceId)) throw new Error('This source is already being processed.');
    const ctrl = new AbortController();
    this.running.set(sourceId, ctrl);
    const { sources } = this.deps;
    let stage: PipelineStage = 'validation';
    const step = async (s: PipelineStage, detail?: string) => {
      if (ctrl.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      stage = s;
      await sources.setStatus(sourceId, 'processing', s);
      this.deps.onProgress?.(sourceId, s, detail);
    };
    try {
      const src = await sources.get(sourceId);
      if (!src) throw new Error('Source not found');
      await step('validation');
      let bytes: Uint8Array | null = null;
      if (src.attachment_id) {
        const att = await this.deps.attachments.get(src.attachment_id);
        if (!att) throw new IngestionError('The stored file is missing.', 'validation');
        bytes = await this.deps.blobs.get(att.storage_key);
        validateBytes(src.kind, bytes);
      } else if (src.kind === 'url') {
        validateUrl(src.origin);
      } else if (src.kind === 'youtube') {
        throw new IngestionError(
          'YouTube transcripts are not available through an authorized public API without the video owner\'s OAuth consent. Paste the transcript as text (YouTube → "Show transcript") instead.',
          'validation',
          'unsupported',
        );
      } else if (src.kind !== 'note') {
        throw new IngestionError('The original file is missing.', 'validation');
      }

      await step('extraction');
      const extracted = await this.extract(src, bytes, ctrl.signal);

      await step('normalization');
      const pages: PageText[] = extracted.pages.map((p) => ({ pageNumber: p.pageNumber, text: normalizeText(p.text) })).filter((p) => p.text);
      if (!pages.length) throw new IngestionError('No readable text was found in this source.', 'extraction', 'empty');

      await step('chunking');
      const { fullText, chunks } = chunkPages(pages);
      await sources.setExtracted(sourceId, fullText, extracted.pageCount, extracted.metadata);
      if (extracted.title && (src.title === src.origin || src.title === src.origin.replace(/\.[^.]+$/, '') || src.kind === 'url')) {
        await sources.rename(sourceId, extracted.title.slice(0, 300));
      }

      await step('embedding', `${chunks.length} chunks`);
      let vectors: number[][] | null = null;
      let model = LOCAL_EMBED_MODEL;
      const provider = await this.deps.getProvider('embeddings');
      if (provider?.embed && provider.capabilities.embeddings) {
        try {
          vectors = await provider.embed(chunks.map((c) => c.text), ctrl.signal);
          model = provider.config.embeddingModel;
        } catch (e) {
          if ((e as Error).name === 'AbortError' || (e as AiError).code === 'cancelled') throw e;
          // Provider failure must not block local use: fall back and record it.
          extracted.metadata.embeddingWarning = `Provider embeddings failed (${(e as Error).message}); using local vectors.`;
          await sources.setExtracted(sourceId, fullText, extracted.pageCount, extracted.metadata);
          vectors = null;
        }
      }
      if (!vectors) {
        vectors = chunks.map((c) => localHashEmbed(c.text));
        model = LOCAL_EMBED_MODEL;
      }

      await step('indexing');
      await sources.replaceChunks(
        sourceId,
        chunks.map((c, i) => ({ ...c, embedding: vectors![i] })),
        model,
      );
      await sources.setStatus(sourceId, 'ready', 'done');
      this.deps.onProgress?.(sourceId, 'done');
    } catch (e) {
      const err = e as Error;
      const cancelled = err.name === 'AbortError' || (e as AiError).code === 'cancelled';
      const failedStage = e instanceof IngestionError ? e.stage : stage;
      await sources.setStatus(sourceId, 'error', failedStage, cancelled ? 'Processing was cancelled.' : err.message || String(e));
      this.deps.onProgress?.(sourceId, failedStage, 'error');
    } finally {
      this.running.delete(sourceId);
    }
    return (await sources.get(sourceId))!;
  }

  private async extract(src: Source, bytes: Uint8Array | null, signal: AbortSignal): Promise<ExtractResult> {
    switch (src.kind) {
      case 'note':
        return { pages: [{ pageNumber: null, text: src.text_content }], pageCount: null, metadata: {} };
      case 'txt':
        return extractPlainText(bytes!);
      case 'markdown':
        return extractMarkdown(bytes!);
      case 'html':
        return extractHtml(bytes!);
      case 'csv':
        return extractCsv(bytes!);
      case 'pdf':
        try {
          return await extractPdf(bytes!, signal);
        } catch (e) {
          // Scanned PDF without a text layer: recognise the rendered pages offline.
          if (!(e instanceof IngestionError) || e.code !== 'empty' || !this.deps.ocr) throw e;
          this.deps.onProgress?.(src.id, 'extraction', 'ocr');
          const pages = await this.deps.ocr.pdf(bytes!, signal);
          if (pages.reduce((n, p) => n + p.text.trim().length, 0) < 20) throw e;
          return { pages, pageCount: pages.length, metadata: { ocr: 'Tesseract (offline)' } };
        }
      case 'docx':
        return extractDocx(bytes!);
      case 'url':
        return this.extractUrl(src.origin, signal);
      case 'image': {
        const mimeGuess = src.mime || (bytes![0] === 0x89 ? 'image/png' : 'image/jpeg');
        if (this.deps.ocr) {
          const local = await this.deps.ocr.image(bytes!, mimeGuess, signal);
          if (local.replace(/\s/g, '').length >= 3) return { pages: [{ pageNumber: null, text: local }], pageCount: null, metadata: { ocr: 'Tesseract (offline)' } };
        }
        // Handwriting or unusual layouts: fall back to a vision-capable AI provider if the user set one up.
        const provider = await this.deps.getProvider('ocr');
        if (!provider?.capabilities.vision && this.deps.ocr) throw new IngestionError('No text was recognised in the image.', 'extraction', 'empty');
        if (!provider?.capabilities.vision)
          throw new IngestionError(
            'Image OCR needs a vision-capable AI provider (OpenAI, Gemini or Anthropic) with permission to upload content. Configure one in Settings.',
            'extraction',
            'requires_provider',
          );
        const mime = mimeGuess;
        const text = await provider.chat({
          system: 'You are an OCR engine. Transcribe all text visible in the image exactly, preserving reading order and line breaks. Output only the text. If there is no text, output NO_TEXT.',
          messages: [{ role: 'user', content: 'Transcribe the text in this image.', image: { mime, base64: toBase64(bytes!) } }],
          signal,
          temperature: 0,
        });
        if (!text.trim() || text.trim() === 'NO_TEXT') throw new IngestionError('No text was recognised in the image.', 'extraction', 'empty');
        return { pages: [{ pageNumber: null, text }], pageCount: null, metadata: { ocr: provider.label } };
      }
      case 'audio': {
        const provider = await this.deps.getProvider('transcription');
        if (!provider?.transcribe || !provider.capabilities.transcription)
          throw new IngestionError(
            'Audio transcription needs a provider with speech-to-text (OpenAI or Gemini) and permission to upload content. Configure one in Settings.',
            'extraction',
            'requires_provider',
          );
        const text = await provider.transcribe(bytes!, src.origin, src.mime, signal);
        if (!text.trim()) throw new IngestionError('The transcription was empty.', 'extraction', 'empty');
        return { pages: [{ pageNumber: null, text }], pageCount: null, metadata: { transcribedBy: provider.label } };
      }
      default:
        throw new IngestionError(`Unsupported source type: ${src.kind}`, 'extraction', 'unsupported');
    }
  }

  private async extractUrl(url: string, signal: AbortSignal): Promise<ExtractResult> {
    validateUrl(url);
    let res: Response;
    try {
      res = await this.deps.fetchUrl(url, signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new IngestionError(`Could not download the page: ${(e as Error).message}`, 'extraction', 'network');
    }
    if (!res.ok) throw new IngestionError(`The page returned HTTP ${res.status}.`, 'extraction', 'network');
    const type = res.headers.get('content-type') ?? '';
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 20 * 1024 * 1024) throw new IngestionError('The page is too large to import.', 'validation', 'too_large');
    if (type.includes('application/pdf')) return extractPdf(buf, signal);
    if (!/text\/|html|xml|json/.test(type) && type) throw new IngestionError(`Unsupported content type: ${type}`, 'extraction', 'unsupported');
    const raw = new TextDecoder().decode(buf);
    if (type.includes('html') || /<html|<body/i.test(raw)) {
      const { text, title } = htmlToText(raw);
      if (text.length < 40) throw new IngestionError('The page has almost no readable text (it may require JavaScript or a login).', 'extraction', 'empty');
      return { pages: [{ pageNumber: null, text }], pageCount: null, metadata: { url }, title };
    }
    return { pages: [{ pageNumber: null, text: raw }], pageCount: null, metadata: { url } };
  }
}
