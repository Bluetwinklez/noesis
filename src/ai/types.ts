export type ProviderId = 'none' | 'openai' | 'gemini' | 'anthropic' | 'ollama' | 'custom';

export interface AiConfig {
  provider: ProviderId;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  ttsModel: string;
  ttsVoices: [string, string];
  transcriptionModel: string;
  temperature: number;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Optional inline image for vision requests. */
  image?: { mime: string; base64: string };
}

export interface ChatRequest {
  system?: string;
  messages: ChatTurn[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
}

export interface Capabilities {
  chat: boolean;
  embeddings: boolean;
  tts: boolean;
  /** True only when the provider can synthesise distinct voices natively in one request or via per-line voices. */
  multiSpeakerTts: boolean;
  transcription: boolean;
  vision: boolean;
}

export interface SpeechResult {
  bytes: Uint8Array;
  mime: string;
}

export interface AiProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly config: AiConfig;
  readonly capabilities: Capabilities;
  /** True when requests leave this machine (cloud API). */
  readonly isCloud: boolean;
  chat(req: ChatRequest): Promise<string>;
  embed?(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  speech?(lines: { speaker: number; text: string }[], language: string, signal?: AbortSignal): Promise<SpeechResult>;
  transcribe?(bytes: Uint8Array, fileName: string, mime: string, signal?: AbortSignal): Promise<string>;
}

export type AiErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'bad_request'
  | 'server'
  | 'cancelled'
  | 'consent'
  | 'unsupported';

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }

  /** Errors the user can fix and retry without restarting. */
  get recoverable() {
    return this.code !== 'unsupported';
  }
}

export const PROVIDER_DEFAULTS: Record<Exclude<ProviderId, 'none'>, Omit<AiConfig, 'provider' | 'temperature'>> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    chatModel: 'gpt-5-mini',
    embeddingModel: 'text-embedding-3-small',
    ttsModel: 'gpt-4o-mini-tts',
    ttsVoices: ['alloy', 'verse'],
    transcriptionModel: 'gpt-4o-mini-transcribe',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    chatModel: 'gemini-2.5-flash',
    embeddingModel: 'gemini-embedding-001',
    ttsModel: 'gemini-2.5-flash-preview-tts',
    ttsVoices: ['Kore', 'Puck'],
    transcriptionModel: 'gemini-2.5-flash',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    chatModel: 'claude-sonnet-5-5',
    embeddingModel: '',
    ttsModel: '',
    ttsVoices: ['', ''],
    transcriptionModel: '',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    chatModel: 'llama3.2',
    embeddingModel: 'nomic-embed-text',
    ttsModel: '',
    ttsVoices: ['', ''],
    transcriptionModel: '',
  },
  custom: {
    baseUrl: 'http://localhost:1234/v1',
    chatModel: '',
    embeddingModel: '',
    ttsModel: '',
    ttsVoices: ['alloy', 'verse'],
    transcriptionModel: '',
  },
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'none',
  temperature: 0.3,
  ...PROVIDER_DEFAULTS.openai,
};
