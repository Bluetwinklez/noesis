import { httpFetch } from '../lib/platform';
import {
  AiError,
  type AiConfig,
  type AiProvider,
  type Capabilities,
  type ChatRequest,
  type ProviderId,
  type SpeechResult,
} from './types';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Maps HTTP failures to user-facing, recoverable errors. Never echoes secrets. */
export async function toAiError(res: Response, providerLabel: string): Promise<AiError> {
  let detail = '';
  try {
    const body = await res.text();
    const j = JSON.parse(body);
    detail = j?.error?.message ?? j?.message ?? '';
  } catch {
    /* non-JSON body */
  }
  detail = String(detail).replace(/(sk|AIza|key)[-_A-Za-z0-9]{8,}/g, '[redacted]').slice(0, 300);
  const s = res.status;
  if (s === 401 || s === 403)
    return new AiError('auth', `${providerLabel} rejected the API key (HTTP ${s}). Check the key in Settings → AI providers.`, s);
  if (s === 429) return new AiError('rate_limit', `${providerLabel} rate limit or quota reached. Wait a moment and retry.${detail ? ' ' + detail : ''}`, s);
  if (s === 400 && /api key/i.test(detail))
    return new AiError('auth', `${providerLabel} rejected the API key. Check the key in Settings → AI providers.`, s);
  if (s === 404) return new AiError('bad_request', `${providerLabel}: model or endpoint not found. Check the model name. ${detail}`, s);
  if (s >= 500) return new AiError('server', `${providerLabel} is temporarily unavailable (HTTP ${s}).`, s);
  return new AiError('bad_request', `${providerLabel} request failed (HTTP ${s}). ${detail}`, s);
}

export function wrapFetchError(e: unknown, label: string): AiError {
  if (e instanceof AiError) return e;
  if ((e as Error)?.name === 'AbortError') return new AiError('cancelled', 'Request cancelled.');
  return new AiError('network', `Could not reach ${label}. Check your internet connection or the server address. (${(e as Error)?.message ?? e})`);
}

/** Reads a server-sent-events stream, yielding each `data:` payload. */
export async function* readSse(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) {
    const text = await res.text();
    for (const line of text.split('\n')) if (line.startsWith('data:')) yield line.slice(5).trim();
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    if (buf.startsWith('data:')) yield buf.slice(5).trim();
  } finally {
    reader.releaseLock?.();
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Wraps raw 16-bit little-endian mono PCM into a WAV container. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.byteLength, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

const LABELS: Record<ProviderId, string> = {
  none: 'No provider',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic',
  ollama: 'Ollama (local)',
  custom: 'OpenAI-compatible server',
};

/** OpenAI and any OpenAI-compatible server (Ollama, LM Studio, vLLM, …). */
export class OpenAICompatibleProvider implements AiProvider {
  readonly label: string;
  readonly capabilities: Capabilities;
  readonly isCloud: boolean;

  constructor(
    readonly id: ProviderId,
    readonly config: AiConfig,
    private apiKey: string | null,
    private fetchFn: FetchFn = httpFetch,
  ) {
    this.label = LABELS[id];
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(config.baseUrl);
    this.isCloud = !local;
    this.capabilities = {
      chat: !!config.chatModel,
      embeddings: !!config.embeddingModel,
      tts: !!config.ttsModel,
      multiSpeakerTts: !!config.ttsModel && !!config.ttsVoices[1],
      transcription: !!config.transcriptionModel,
      vision: id === 'openai',
    };
  }

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private url(path: string) {
    return this.config.baseUrl.replace(/\/+$/, '') + path;
  }

  async chat(req: ChatRequest): Promise<string> {
    if (this.id === 'openai' && !this.apiKey) throw new AiError('not_configured', 'Add an OpenAI API key in Settings → AI providers.');
    const messages: unknown[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) {
      if (m.image)
        messages.push({
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: `data:${m.image.mime};base64,${m.image.base64}` } },
          ],
        });
      else messages.push({ role: m.role, content: m.content });
    }
    const stream = !!req.onToken;
    const body: Record<string, unknown> = { model: this.config.chatModel, messages, stream };
    if (!/^(gpt-5|o\d)/.test(this.config.chatModel)) body.temperature = req.temperature ?? this.config.temperature;
    if (req.maxTokens) body.max_completion_tokens = req.maxTokens;
    if (req.json) body.response_format = { type: 'json_object' };
    let res: Response;
    try {
      res = await this.fetchFn(this.url('/chat/completions'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: req.signal });
    } catch (e) {
      throw wrapFetchError(e, this.label);
    }
    if (!res.ok) throw await toAiError(res, this.label);
    try {
      if (!stream) {
        const j = await res.json();
        return j.choices?.[0]?.message?.content ?? '';
      }
      let out = '';
      for await (const data of readSse(res, req.signal)) {
        if (data === '[DONE]') break;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) {
            out += delta;
            req.onToken!(delta);
          }
        } catch {
          /* keep-alive or partial line */
        }
      }
      return out;
    } catch (e) {
      throw wrapFetchError(e, this.label);
    }
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!this.config.embeddingModel) throw new AiError('unsupported', 'No embedding model configured.');
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      let res: Response;
      try {
        res = await this.fetchFn(this.url('/embeddings'), {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ model: this.config.embeddingModel, input: texts.slice(i, i + 64) }),
          signal,
        });
      } catch (e) {
        throw wrapFetchError(e, this.label);
      }
      if (!res.ok) throw await toAiError(res, this.label);
      const j = await res.json();
      for (const d of j.data ?? []) out.push(d.embedding);
    }
    if (out.length !== texts.length) throw new AiError('server', 'Embedding response was incomplete.');
    return out;
  }

  async speech(lines: { speaker: number; text: string }[], _language: string, signal?: AbortSignal): Promise<SpeechResult> {
    if (!this.config.ttsModel) throw new AiError('unsupported', `${this.label} has no text-to-speech model configured.`);
    const parts: Uint8Array[] = [];
    for (const line of lines) {
      let res: Response;
      try {
        res = await this.fetchFn(this.url('/audio/speech'), {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            model: this.config.ttsModel,
            voice: this.config.ttsVoices[line.speaker % 2] || this.config.ttsVoices[0],
            input: line.text,
            response_format: 'pcm',
          }),
          signal,
        });
      } catch (e) {
        throw wrapFetchError(e, this.label);
      }
      if (!res.ok) throw await toAiError(res, this.label);
      parts.push(new Uint8Array(await res.arrayBuffer()));
      parts.push(new Uint8Array(24000 * 2 * 0.35)); // short pause between lines
    }
    return { bytes: pcmToWav(concatBytes(parts), 24000), mime: 'audio/wav' };
  }

  async transcribe(bytes: Uint8Array, fileName: string, mime: string, signal?: AbortSignal): Promise<string> {
    if (!this.config.transcriptionModel) throw new AiError('unsupported', `${this.label} has no transcription model configured.`);
    const form = new FormData();
    form.append('model', this.config.transcriptionModel);
    form.append('file', new Blob([bytes as BlobPart], { type: mime || 'application/octet-stream' }), fileName);
    let res: Response;
    try {
      res = await this.fetchFn(this.url('/audio/transcriptions'), { method: 'POST', headers: this.headers(false), body: form, signal });
    } catch (e) {
      throw wrapFetchError(e, this.label);
    }
    if (!res.ok) throw await toAiError(res, this.label);
    const j = await res.json();
    return j.text ?? '';
  }
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const;
  readonly label = LABELS.gemini;
  readonly isCloud = true;
  readonly capabilities: Capabilities;

  constructor(
    readonly config: AiConfig,
    private apiKey: string | null,
    private fetchFn: FetchFn = httpFetch,
  ) {
    this.capabilities = {
      chat: true,
      embeddings: !!config.embeddingModel,
      tts: !!config.ttsModel,
      multiSpeakerTts: !!config.ttsModel,
      transcription: true,
      vision: true,
    };
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    if (!this.apiKey) throw new AiError('not_configured', 'Add a Gemini API key in Settings → AI providers.');
    let res: Response;
    try {
      res = await this.fetchFn(this.config.baseUrl.replace(/\/+$/, '') + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw wrapFetchError(e, this.label);
    }
    if (!res.ok) throw await toAiError(res, this.label);
    return res;
  }

  async chat(req: ChatRequest): Promise<string> {
    const contents = req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }, ...(m.image ? [{ inline_data: { mime_type: m.image.mime, data: m.image.base64 } }] : [])],
    }));
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? this.config.temperature,
        ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
    const model = encodeURIComponent(this.config.chatModel);
    try {
      if (!req.onToken) {
        const res = await this.post(`/models/${model}:generateContent`, body, req.signal);
        const j = await res.json();
        return (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
      }
      const res = await this.post(`/models/${model}:streamGenerateContent?alt=sse`, body, req.signal);
      let out = '';
      for await (const data of readSse(res, req.signal)) {
        try {
          const parts = JSON.parse(data).candidates?.[0]?.content?.parts ?? [];
          const delta = parts.map((p: { text?: string }) => p.text ?? '').join('');
          if (delta) {
            out += delta;
            req.onToken(delta);
          }
        } catch {
          /* ignore */
        }
      }
      return out;
    } catch (e) {
      throw wrapFetchError(e, this.label);
    }
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const model = this.config.embeddingModel;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const res = await this.post(
        `/models/${encodeURIComponent(model)}:batchEmbedContents`,
        { requests: texts.slice(i, i + 100).map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) },
        signal,
      );
      const j = await res.json();
      for (const e of j.embeddings ?? []) out.push(e.values);
    }
    if (out.length !== texts.length) throw new AiError('server', 'Embedding response was incomplete.');
    return out;
  }

  async speech(lines: { speaker: number; text: string }[], _language: string, signal?: AbortSignal): Promise<SpeechResult> {
    const speakers = [...new Set(lines.map((l) => l.speaker))];
    const names = ['Host A', 'Host B'];
    const prompt =
      speakers.length > 1
        ? lines.map((l) => `${names[l.speaker % 2]}: ${l.text}`).join('\n')
        : lines.map((l) => l.text).join('\n\n');
    const speechConfig =
      speakers.length > 1
        ? {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [0, 1].map((i) => ({
                speaker: names[i],
                voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.ttsVoices[i] || 'Kore' } },
              })),
            },
          }
        : { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.ttsVoices[0] || 'Kore' } } };
    const res = await this.post(
      `/models/${encodeURIComponent(this.config.ttsModel)}:generateContent`,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig } },
      signal,
    );
    const j = await res.json();
    const b64 = j.candidates?.[0]?.content?.parts?.find((p: { inlineData?: { data: string } }) => p.inlineData)?.inlineData?.data;
    if (!b64) throw new AiError('server', 'Gemini returned no audio.');
    return { bytes: pcmToWav(fromBase64(b64), 24000), mime: 'audio/wav' };
  }

  async transcribe(bytes: Uint8Array, _fileName: string, mime: string, signal?: AbortSignal): Promise<string> {
    if (bytes.byteLength > 18 * 1024 * 1024) throw new AiError('unsupported', 'Audio files over 18 MB cannot be transcribed inline by Gemini.');
    const res = await this.post(
      `/models/${encodeURIComponent(this.config.transcriptionModel || this.config.chatModel)}:generateContent`,
      {
        contents: [
          {
            parts: [
              { text: 'Transcribe this audio verbatim. Output only the transcript text.' },
              { inline_data: { mime_type: mime || 'audio/mpeg', data: toBase64(bytes) } },
            ],
          },
        ],
      },
      signal,
    );
    const j = await res.json();
    return (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  }
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const;
  readonly label = LABELS.anthropic;
  readonly isCloud = true;
  readonly capabilities: Capabilities = {
    chat: true,
    embeddings: false,
    tts: false,
    multiSpeakerTts: false,
    transcription: false,
    vision: true,
  };

  constructor(
    readonly config: AiConfig,
    private apiKey: string | null,
    private fetchFn: FetchFn = httpFetch,
  ) {}

  async chat(req: ChatRequest): Promise<string> {
    if (!this.apiKey) throw new AiError('not_configured', 'Add an Anthropic API key in Settings → AI providers.');
    const body: Record<string, unknown> = {
      model: this.config.chatModel,
      max_tokens: req.maxTokens ?? 4096,
      stream: !!req.onToken,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.image
          ? [
              { type: 'image', source: { type: 'base64', media_type: m.image.mime, data: m.image.base64 } },
              { type: 'text', text: m.content },
            ]
          : m.content,
      })),
    };
    if (req.system) body.system = req.system + (req.json ? '\nRespond with valid JSON only.' : '');
    else if (req.json) body.system = 'Respond with valid JSON only.';
    let res: Response;
    try {
      res = await this.fetchFn(this.config.baseUrl.replace(/\/+$/, '') + '/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e) {
      throw wrapFetchError(e, this.label);
    }
    if (!res.ok) throw await toAiError(res, this.label);
    try {
      if (!req.onToken) {
        const j = await res.json();
        return (j.content ?? []).map((b: { text?: string }) => b.text ?? '').join('');
      }
      let out = '';
      for await (const data of readSse(res, req.signal)) {
        try {
          const ev = JSON.parse(data);
          if (ev.type === 'content_block_delta' && ev.delta?.text) {
            out += ev.delta.text;
            req.onToken(ev.delta.text);
          }
          if (ev.type === 'error') throw new AiError('server', ev.error?.message ?? 'Stream error');
        } catch (e) {
          if (e instanceof AiError) throw e;
        }
      }
      return out;
    } catch (e) {
      throw wrapFetchError(e, this.label);
    }
  }
}

export function createProvider(config: AiConfig, apiKey: string | null, fetchFn?: FetchFn): AiProvider | null {
  switch (config.provider) {
    case 'openai':
    case 'ollama':
    case 'custom':
      return new OpenAICompatibleProvider(config.provider, config, apiKey, fetchFn);
    case 'gemini':
      return new GeminiProvider(config, apiKey, fetchFn);
    case 'anthropic':
      return new AnthropicProvider(config, apiKey, fetchFn);
    default:
      return null;
  }
}

export { toBase64, fromBase64 };
