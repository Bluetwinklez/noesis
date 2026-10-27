# NotebookLM-inspired features: research records

**REA tool used** is `none (blocked)` for every record. `notebooklm.google` and `support.google.com` were denied by the network policy (see [README](README.md)). Evidence comes from public secondary sources found by web search, or from *general knowledge* (not verified).

Secondary sources:
- TechRepublic, "Google NotebookLM: Expands Sources, Adds Audio Features" (Sept 2024): https://www.techrepublic.com/article/google-notebooklm-expands-sources-citations/
- Carleton College ITS, "A Beginner's Guide to NotebookLM": https://www.carleton.edu/its/blog/a-beginners-guide-to-notebooklm/ (title and snippet only; the fetch failed with DNS)
- GoTranscript, "NotebookLM for Researchers" transcript: https://gotranscript.com/public/notebooklm-for-researchers-source-grounded-ai-workflows

| # | Feature | Research question | Permitted target | REA tool | Observed behaviour | Evidence | Confidence | Design implication | Noesis implementation (original) |
|---|---|---|---|---|---|---|---|---|---|
| L1 | Source collection | What can be added, and what limits apply? | Public articles | none (blocked) | Notebooks hold up to 50 sources of ≤500,000 words each (2024); Docs, PDFs and web links are supported; higher limits on a paid tier | TechRepublic | Medium (dated) | Show per-source status; limits must fail loudly | Per-workspace source library; 80 MB per-file cap; pipeline stage + error per source |
| L2 | Source selection | Can answers be restricted to some sources? | Public articles | none (blocked) | Chat is limited to the sources the user selects | TechRepublic | Medium | Retrieval must be filtered by the selected set | `notebook_sources` selection; `retrieve({sourceIds})` filters before ranking |
| L3 | Grounded Q&A + citations | How are answers tied to evidence? | Public articles | none (blocked) | Inline numbered references; newer versions jump to the exact passage in the PDF | TechRepublic; GoTranscript ("citation 2.0") | Medium | Each citation needs a chunk with page and offsets so the UI can jump to it | `source_chunks` stores page and char ranges; `[n]` citations are checked against the retrieved chunks; clicking opens the source viewer at the excerpt |
| L4 | Insufficient evidence | What happens when sources lack the answer? | — | none | The assistant says the sources do not cover it | General knowledge | Low | Never invent citations | Empty retrieval returns a fixed message without calling the model; answers with zero valid citations are flagged `insufficient` |
| L5 | Saving to notes | Can answers become notes? | — | none | Responses can be saved as notes inside the notebook | General knowledge | Low | Notes keep their citations | `notebook_notes` with references; "Save to note" and export to a workspace page |
| L6 | Study outputs | Which structured outputs exist? | Public articles | none | Study guide, FAQ, briefing doc, timeline; later flashcards and quizzes | General knowledge | Low | Shared prompt scaffolding with structured JSON output | `assistant.ts`: study guide, FAQ, briefing, flashcards, quiz (JSON-validated), compare documents |
| L7 | Audio overview | What formats exist? | Public articles | none (blocked) | Podcast-style two-host conversation built from sources; styles such as Deep Dive, Brief, Critique and Debate | TechRepublic; Carleton snippet | Medium | Two-speaker output depends on the TTS provider; offer length and language options | `AudioStudio.tsx`: script → TTS through the provider abstraction; two speakers only when `multiSpeakerTts`; length and language; transcript; speed; export. **No interactive "join the conversation" mode.** |

## Differences by design

- Works with any provider, including fully local ones (Ollama), and stores everything on the device.
- Citations are validated in code, not only requested in the prompt.
- Sources are treated as untrusted input (prompt-injection guard). See `docs/security/privacy-security.md`.
