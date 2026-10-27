# Research (REA)

## REA setup: verified

| Step | Result | Evidence |
|---|---|---|
| Install | `npm install -g rea-agents@6.8.0` | `rea --help` lists 100+ commands |
| Runtime | REA requires Node ≥ 22.23.4 / 24.22.1. The container had Node 22.22.0, so REA ran on Node 24.22.1 (official tarball, SHA-256 verified against `SHASUMS256.txt`) | `rea doctor`: `node ok 24.22.1` |
| `rea doctor` | Native engines (Hopper, Ghidra, IDA, JADX, Kuna) are not installed. They are not needed for web/JS analysis | doctor output, 2026-10-27 |
| Agent registration (`npx rea-agents setup`) | **Not run.** It is interactive and edits the agent's MCP configuration. Codex is not present in this environment, and the CLI commands were enough | — |

REA is used only at development time. The shipped app does not depend on it.

## What REA could and could not analyse

| Target | Permitted? | Outcome |
|---|---|---|
| `www.notion.com/help/*` (public help pages) | Yes, public documentation | **BLOCKED.** The environment's network policy denies the host (proxy `CONNECT` → 403). Chromium shows "This site can't be reached"; `rea inspect-web-page` returns `target_not_allowed` because the page is a `chrome-error://` document |
| `support.google.com/notebooklm/*` | Yes, public documentation | **BLOCKED** (same cause) |
| `notebooklm.google` (public landing page) | Yes | **BLOCKED** (same cause) |
| Logged-in Notion / NotebookLM apps | Only with the user's own authorised account | Not attempted: no account, and blocked anyway |
| Noesis's own production bundle (`dist/`) | Yes, our own code | **Done.** See [rea-self-analysis.md](rea-self-analysis.md) |

To unblock the live research, allow `notion.com`, `www.notion.com`, `support.google.com` and `notebooklm.google` in the cloud environment's network settings. Then re-run the commands in [rea-self-analysis.md § Reproduce](rea-self-analysis.md#reproduce) against those targets.

## Reports

- [notion-inspired.md](notion-inspired.md): editor, pages and database features
- [notebooklm-inspired.md](notebooklm-inspired.md): sources, grounded Q&A, citations and audio
- [rea-self-analysis.md](rea-self-analysis.md): REA static analysis of the Noesis bundle and the change it led to

Because REA could not reach the competitor targets, the feature reports rely on public secondary sources (web search results) and on general product knowledge. Each record says which. **None of their "observed behaviour" entries is REA evidence.** Confidence levels reflect that.
