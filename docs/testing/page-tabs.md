# Page tabs, split view and contents

Page navigation opens a tab; the adjacent split control opens another tab alongside it. Open tabs and split selection are stored per workspace. Closing a tab chooses a neighbour. A page exposes a live heading panel and `/toc` inserts a live contents block. The block survives HTML and Markdown transfer.

`tests/unit/tabs.test.ts` checks stale and duplicate tab state, close behaviour and contents serialization. The browser test covers split editors, pending write flush, reopening the workspace, heading outline and block insertion. Each PageView registers its own content/title flushers; tab preference writes register a flusher as well. A real Windows close-to-tray, tray Quit and updater workflow remains an owner-run verification.

The existing start-page preference remains authoritative: when configured to open Home, the stored tabs are restored when a page is opened; choosing the last page opens the page workspace at startup. Test results are browser-preview evidence, not a packaged Windows desktop test.
