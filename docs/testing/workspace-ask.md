# Ask across notebooks and pages

The notebook list can ask across pages and ready sources connected to any notebook in the active workspace. Pages are split into passages, source offsets remain attached to their original source, and local lexical/hash ranking produces a bounded context. The local hash vector is not a neural embedding model; lexical candidates are required and relevant paraphrases may be missed. An empty result returns the existing unsupported-evidence warning without a model call. Citation presence does not prove factual support.

The UI keeps answers only while the view remains open; it sanitizes generated Markdown and opens the cited page or source passage. Unit tests in `tests/unit/workspace-retrieval.test.ts` cover ordering, workspace isolation, mock-provider citations and missing evidence. The Playwright scenario exercises both page and source citations plus the warning. These tests use the mock AI service, not a live provider.
