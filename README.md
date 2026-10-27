<div align="center">
  <img src="public/icon.svg" width="76" height="76" alt="Noesis logo" />
  <h1>Noesis</h1>
  <p><strong>Your notes. Your sources. A clearer picture.</strong></p>
  <p>A local-first desktop workspace for writing, research and connected thinking.</p>
  <p>
    <a href="https://github.com/Bluetwinklez/noesis/actions/workflows/ci.yml"><img src="https://github.com/Bluetwinklez/noesis/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
    <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4" alt="Windows 10 and 11" />
    <img src="https://img.shields.io/badge/status-early%20preview-D99B32" alt="Early preview" />
    <img src="https://img.shields.io/badge/built%20with-Tauri%202-24C8D8" alt="Built with Tauri 2" />
  </p>
  <p><a href="https://github.com/Bluetwinklez/noesis/releases"><strong>Download for Windows</strong></a> · <a href="#get-started">Get started</a> · <a href="docs/ai-configuration.md">Connect AI</a> · <a href="docs/implementation-status.md">Project status</a></p>
</div>

![Noesis block editor with nested pages, a checklist, callout and math formula](docs/images/editor.png)

Noesis brings block-based notes and source-grounded research into one application. Organize a project, collect its documents, ask questions with navigable citations, and turn the results into notes you can keep editing.

Your workspace lives on your computer. Notes, databases, tasks and local search work without an account, an AI key or an internet connection. Cloud AI is optional and requires your consent.

> **Early preview · v0.1.0.** Windows installers are unsigned. AI integrations are covered by mock-provider tests; compatibility with live APIs is not yet verified. See [known limitations](#known-limitations) before relying on this preview for important work.

## What you can do

| Write and organize | Research and understand |
| --- | --- |
| Rich-text blocks, slash commands, Markdown paste and drag handles | Collect PDFs, DOCX, Markdown, text, HTML, CSV and web sources |
| Nested pages, workspaces, tags, favorites and backlinks | Select the sources each notebook should use |
| Tables, code, math, checklists, callouts, images and attachments | Ask questions with streamed answers and source references |
| Autosave, page history, trash and restore | Generate summaries, study guides, flashcards and quizzes |
| Databases with table, board, calendar, list and gallery views | Preview AI writing changes before applying them |
| Tasks, recurring reminders, search and a knowledge graph | Create audio overviews with a supported provider |

### A research desk for your own sources

![Noesis research notebook with its selected source, chat and studio panels](docs/images/research.png)

Import documents, review extracted text, then choose which sources a notebook can use. Retrieved passages retain source, page and text-location information. Citation markers are checked against retrieved passages, and clicking a reference opens the relevant source excerpt. A valid reference does not guarantee that the model interpreted it correctly; review the evidence when accuracy matters.

### Structure that fits your work

![Noesis reading database displayed as a Kanban board](docs/images/database.png)

Track projects and reading lists with typed properties, filters, sorting, grouping and saved views. Use recurring tasks and subtasks alongside the notes that give them context.

<details>
  <summary><strong>See dark mode</strong></summary>

![Noesis database in dark mode](docs/images/dark-mode.png)

</details>

*Screenshots show the real application in browser-preview mode with its built-in sample workspace. The Windows application uses the same interface in a native Tauri shell.*

## Download and install

1. Open [Releases](https://github.com/Bluetwinklez/noesis/releases). Preview releases are listed there even when GitHub's “latest stable release” link is unavailable.
2. Download **`Noesis_0.1.0_x64-setup.exe`** for a normal per-user installation. MSI packages are also provided for managed deployment.
3. Optionally compare the file's SHA-256 hash with `SHA256SUMS.txt` from the same release:

   ```powershell
   Get-FileHash .\Noesis_0.1.0_x64-setup.exe -Algorithm SHA256
   ```

4. Run the installer and complete onboarding. You can skip AI setup and start with sample content.

**Requirements:** Windows 10 or 11, x64. The installer can download Microsoft WebView2 if it is missing. Installers are **not code-signed** and may trigger Windows warnings or be blocked by device policy. Code signing and automatic updates are not included in this preview.

Uninstall through **Settings → Apps → Installed apps → Noesis**. Workspace data is kept in `%APPDATA%\app.noesis.desktop`. Export a backup before upgrading or changing your installation.

## Get started

1. **Make a workspace.** Choose a theme and create your first page. Sample content is optional.
2. **Capture an idea.** Use `/` to insert a block and `@` to mention another page.
3. **Bring in sources.** Open Sources, import documents, and check the extraction status.
4. **Open a research notebook.** Select its sources. To ask AI questions, configure a provider in Settings.
5. **Keep the useful parts.** Review citations and save generated material as editable notes.
6. **Back up your work.** Use Settings → Storage & backups to export a `.noesisbak` archive.

### AI, on your terms

Noesis includes adapters for OpenAI, Gemini, Anthropic, Ollama and OpenAI-compatible servers. Capabilities vary by provider and model. API usage may carry provider charges.

- **Cloud:** the application requests permission before sending content. Desktop API keys use Windows Credential Manager.
- **Local:** use an Ollama or compatible server on your computer. Offline semantic search also has a lightweight local-vector fallback.
- **Try without a key:** run `node scripts/mock-ai-server.mjs 11435`, choose an OpenAI-compatible server at `http://127.0.0.1:11435/v1`, and enter `test-key`. This produces deterministic test responses, not real AI reasoning.

See [AI configuration](docs/ai-configuration.md) and [privacy & security](docs/security/privacy-security.md).

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | Search or run a command |
| `Ctrl+Alt+N` | Create a page |
| `Ctrl+Shift+F` | Open search |
| `Ctrl+,` | Open settings |
| `Ctrl+\` | Toggle the sidebar |
| `Ctrl+Shift+L` | Toggle light/dark appearance |
| `Alt+←` / `Alt+→` | Navigate back/forward |

## Run from source

Install **Node.js 24**, Rust stable, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Windows builds need the Visual Studio C++ Build Tools and WebView2.

```bash
git clone https://github.com/Bluetwinklez/noesis.git
cd noesis
npm ci
npm run dev          # Browser preview: http://localhost:1420
npx tauri dev        # Native desktop application
```

The browser preview uses SQLite WASM and IndexedDB. It is intended for development; its API-key storage does not provide the protection of Windows Credential Manager. Use test keys in the preview.

```bash
npm run typecheck    # TypeScript checks
npm test            # Unit and integration tests
npm run e2e         # Browser workflows (Edge by default)
npm run build       # Production frontend
cd src-tauri
cargo test --locked # Native backend tests; build the frontend first
cd ..
npx tauri build     # Windows NSIS and MSI installers
```

For Chromium instead of Edge, run `npx playwright install chromium` and set `PW_CHANNEL=chromium`. [Testing documentation](docs/testing/README.md) explains each check. `npm run screenshots` regenerates the README images from sample data.

## Reliability and release checks

The release workflow checks TypeScript, unit/integration tests, browser workflows and production dependencies. A Windows runner then executes Rust tests, builds NSIS/MSI installers, installs the NSIS package, launches the app, checks database creation and uninstalls it. Published assets include SHA-256 checksums.

Backup creation uses a consistent database snapshot and refuses to silently omit missing attachments. Restore validates manifest versions, table counts and attachment checksums before replacing data. Cancelling the safety-backup dialog also cancels the restore.

These checks are useful evidence, not a claim that every device or live AI provider has been tested. The [implementation status](docs/implementation-status.md) keeps that distinction explicit.

## Known limitations

- Preview software; installers are unsigned and there is no automatic updater.
- Live AI provider compatibility, OCR, transcription and speech quality still need real-provider verification.
- No cloud sync or YouTube transcript import. PDF export uses the system print dialog.
- Local hashed vectors are a fallback, not a replacement for a trained embedding model.
- Notifications require the app to be running. Very large graphs and source collections need further performance testing.
- Generic SQL IPC and hostname-based URL filtering remain hardening work; see [security notes](docs/security/privacy-security.md).
- English and Turkish interfaces are available. Repository documentation and release notes are maintained in English.

## Roadmap

- [ ] Verify live provider chat, embeddings, OCR, transcription and audio.
- [ ] Add a trained local embedding model and offline OCR.
- [ ] Introduce code signing and a verified update channel.
- [ ] Narrow native IPC commands and strengthen URL/DNS validation.
- [ ] Improve large-document and large-graph performance with recorded benchmarks.
- [ ] Add direct PDF/DOCX export, database rollups and CSV-to-database import.
- [ ] Explore a web clipper, quick capture and user-controlled synchronization.

## Documentation and contributing

[Architecture](docs/architecture/README.md) · [Database schema](docs/architecture/database-schema.md) · [AI setup](docs/ai-configuration.md) · [Security](docs/security/privacy-security.md) · [Testing](docs/testing/README.md) · [Benchmarks](docs/testing/benchmarks.md) · [Research](docs/research/README.md) · [Releasing](docs/releases/README.md) · [Release notes](docs/releases/v0.1.0.md)

Found a bug? [Open an issue](https://github.com/Bluetwinklez/noesis/issues/new) with reproduction steps, your OS, app version and relevant redacted diagnostics. Never include API keys or private source documents. For code contributions, start with [CONTRIBUTING.md](CONTRIBUTING.md).

Noesis is an independent implementation inspired by publicly documented workspace and research concepts. It is not affiliated with Notion or Google NotebookLM and includes no proprietary code, branding or private APIs from either product.
