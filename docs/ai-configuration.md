# AI configuration

AI is optional. Without a provider, everything except AI chat, AI writing actions, OCR, transcription and audio overviews works. Search uses offline keyword search plus the local `local-hash-512` vectors.

Open **Settings → AI providers**, choose a provider, enter the API key and press **Test connection**.

## Providers

| Provider | Default base URL | Chat | Embeddings | TTS (audio overview) | Transcription / OCR |
|---|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-5-mini` | `text-embedding-3-small` | `gpt-4o-mini-tts`, 2 voices → two-speaker dialogue (one voice per line, stitched) | `gpt-4o-mini-transcribe`; OCR via vision chat |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.5-flash` | `gemini-embedding-001` | `gemini-2.5-flash-preview-tts`, native multi-speaker | Gemini multimodal |
| Anthropic Claude | `https://api.anthropic.com/v1` | `claude-sonnet-5-5` | — (falls back to local vectors) | — | OCR via vision; no audio transcription |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` | `nomic-embed-text` | — | — (no image OCR) |
| OpenAI-compatible (LM Studio, vLLM, …) | `http://localhost:1234/v1` | user-set | user-set | user-set | transcription if set; no image OCR (vision is enabled for the OpenAI preset only) |

Every model name can be changed. The defaults are starting points, not recommendations. The audio overview UI checks the provider's capabilities. If the provider has no TTS model, the audio overview offers only the script and transcript and does not claim to produce audio. Two-speaker dialogue is offered only when the provider reports `multiSpeakerTts`.

## API keys

- **Desktop:** keys are stored in the Windows Credential Manager through the `keyring` crate (`secret_set` / `secret_get`). They never go into SQLite, settings, backups or logs.
- **Browser preview** (development only): keys are kept in `localStorage`, and the settings screen states that this is **not** secure storage.

## Consent for cloud providers

The first time content would be sent to a cloud provider, the app shows a consent dialog naming the provider. You can allow once or always. Standing consent can be revoked in **Settings → Privacy**. Background jobs such as embedding during ingestion use only standing consent and never prompt. If consent is missing, they fall back to local vectors. Local servers (Ollama, `localhost` custom endpoints) do not ask for consent.

## Errors

Provider failures are mapped to typed `AiError` codes: `auth` (invalid key), `rate_limit`, `network` (offline or timeout), `bad_request` (for example an unknown model), `server`, `cancelled`, `consent`, `not_configured` and `unsupported`. All of them except `unsupported` are marked recoverable. They appear as toasts or inline messages with a retry option. The E2E test "invalid API key produces a recoverable error" covers this path with the mock server.

## Mock server for development

```bash
node scripts/mock-ai-server.mjs 11435   # OpenAI-compatible; valid key: test-key
```

Configure "OpenAI-compatible" with base URL `http://127.0.0.1:11435/v1` and key `test-key`.

## Verification status

The automated tests used only the mock server. The provider adapters have not been tested end to end against the real OpenAI, Gemini or Anthropic APIs in this repository's test runs. Treat them as **unverified against live APIs** until someone checks them manually with a real key (see `docs/implementation-status.md`).
