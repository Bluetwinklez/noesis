# Answer evidence warnings and evaluation

Schema migration v5 adds `chat_messages.insufficient`. Completed assistant answers with no citations are backfilled, and v4 backups receive the same backfill when restored. New RAG results store their `insufficient` flag with the message. Workspace exports include chat messages and the flag; imports remap citation source ids and mark an answer unsupported if its cited sources cannot be restored.

The UI shows an English/Turkish warning for unsupported answers. In otherwise cited answers, sentences without a valid source reference receive a dotted underline and tooltip. This uses `Intl.Segmenter` and a citation-presence heuristic, including references placed after punctuation. It is not a factual sentence classifier. Markdown structure is preserved, model HTML goes through `sanitizeHtml`, and code/links are not turned into citation buttons. A valid citation number is a link to evidence, not proof of the claim.

## Deterministic evaluation

```powershell
npm run eval:ai
```

With no evaluation variables this uses a deterministic mock. CI and release validation explicitly set `NOESIS_EVAL_PROVIDER=mock`. The evaluator is under `tests/eval/`, has a separate Vitest configuration and is excluded from default `npm test`. The default unit suite separately tests its scoring failure cases.

Four synthetic English/Turkish cases cover an enzyme, a numeric excavation finding, a Turkish count and a question not answered by the source. Each case builds an isolated in-memory database and runs actual retrieval and `answerQuestion`. It checks:

- Expected answer terms appear, with citation presence for supported answers.
- Each cited retrieved chunk contains the fixture's expected claim terms and matches the cited source/chunk identity.
- An unsupported question receives a refusal, rather than mistaking any uncited answer for a refusal.

This is a small regression harness. Keyword containment cannot establish entailment, detect every contradiction or negation, or prove factual correctness. A passing mock score verifies wiring and scoring, not the quality or compatibility of a real model.

## Owner-run live checks

Set `NOESIS_EVAL_PROVIDER` to `openai`, `gemini`, `anthropic`, `ollama` or `custom`. Set `NOESIS_EVAL_API_KEY` privately for providers requiring a key. Setting the key alone selects OpenAI. `NOESIS_EVAL_BASE_URL` and `NOESIS_EVAL_CHAT_MODEL` override the provider defaults from `src/ai/types.ts`.

For example, in PowerShell, read a key without echoing it or putting it in command history:

```powershell
$env:NOESIS_EVAL_PROVIDER = 'openai'
$evalSecret = Read-Host 'Evaluation API key' -AsSecureString
$env:NOESIS_EVAL_API_KEY = [System.Net.NetworkCredential]::new('', $evalSecret).Password
npm run eval:ai
Remove-Item Env:NOESIS_EVAL_API_KEY
```

For Ollama, select `ollama`, set `NOESIS_EVAL_CHAT_MODEL` to an installed model name, and optionally override its base URL. No cloud API key is required for a local unauthenticated endpoint. Clear evaluation variables after the run to return to mock mode.

Live evaluation sends only the synthetic fixtures. It reads no Noesis workspace, app keyring or user documents. Embeddings remain local so this checks real chat/citation behavior, not live embeddings, OCR, transcription or speech. Each request has a 60-second abort timeout. Errors expose provider/error codes without logging credentials or request details. Real calls may incur the provider's usage charges. Agents have not run these live checks; the owner must record the provider/model and results separately.
