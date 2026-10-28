# Studio source coverage

All Studio documents, flashcards, quizzes and audio scripts use the same context preparation path in `src/ai/studio-context.ts`.

## Budget and work limits

The application estimates one token as four characters, as its retrieval path does. The default source context is 24,000 estimated tokens (16,000 for audio scripts). Source wrappers, separators and escaped titles count toward the character limit. System instructions and the final generation task are outside this source-context budget. This is not a provider-specific tokenizer or a guarantee about a model's total context limit.

Short sources retain their entire text and release unused space to longer sources. A source that exceeds its share is split into parts of at most 40,000 characters. At most 16 parts per source are sent to the already consented provider for dense factual summaries. If more parts exist, evenly spaced parts include the beginning and end; the UI explicitly reports how many original characters were processed. Condensation can cost up to 16 additional model requests per long source. Requests run sequentially, and cancellation stops further calls.

Each part gets a share of its source's output space. A provider that ignores its output limit cannot overflow the final context: its result is shortened, and the coverage note warns that details may be missing. Coverage measures original characters sent for condensation, not a proof that every fact survived summarization. The UI also warns about the inherent loss of detail.

Source numbering remains in original selection order. Condensed source citations open the original document without pretending that paraphrased text is a verbatim passage at a particular offset. Generated Studio note metadata survives database backups and workspace ZIP export/import. The ZIP format adds optional notebook records and source reference ids while retaining compatibility with older exports; imported source-level citations receive new source ids. Audio coverage is shown during the current generation session, without changing the audio database schema.

## Verification

```powershell
npx vitest run tests/unit/studio-context.test.ts tests/unit/export.test.ts
npx playwright test -g "Studio condenses"
```

The first three regression tests were run against the original implementation and all failed before the fix. A deterministic mock places a unique fact only at the end of a long document and checks that it reaches the final generation request. Other cases cover 50 sources, fair redistribution, cancellation, capped work, source numbering, metadata validation, output clipping and the flashcard/quiz/audio paths. Transfer tests verify coverage in a backup and a workspace export with newly assigned source ids, including a workspace containing only research material.

The Playwright flow imports synthetic long text, generates a summary, checks its coverage note and opens the saved note after reloading the browser database. These checks exercise the browser preview and mock provider. They do not verify real OpenAI, Gemini, Anthropic or Ollama behavior, summary fidelity, native Windows shutdown or an actual signed update. Those remain owner verification tasks.
