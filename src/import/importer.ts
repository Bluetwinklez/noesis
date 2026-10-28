/**
 * Imports Notion exports ("Markdown & CSV" zip) and Obsidian vaults (zip or
 * selected .md files) into the current workspace.
 *
 * - Folder structure becomes nested pages (Notion: "Page <id>.md" + "Page <id>/").
 * - Notion links to other exported pages, Obsidian [[wikilinks]] and
 *   ![[embeds]] become Noesis page links and stored images.
 * - Notion database CSVs become databases (text / number / checkbox / URL columns).
 * - Noesis's own export (exporter.ts) round-trips: exact titles and icons from
 *   its manifest, tasks restored as tasks, sources handed back for re-ingestion.
 * Everything happens in two passes, so links can point at pages created later.
 */
import JSZip from 'jszip';
import type { Repos } from '../core/store';
import { PAGE_LINK_PREFIX } from '../core/doc';
import { htmlToDoc } from '../editor/serialize';
import { markdownToHtml } from '../editor/markdown';
import { parseCsv } from '../ingestion/extractors';
import { sha256Hex } from '../lib/util';
import { DATA_DIR, EXPORT_FORMAT, type ExportManifest, type ExportedSource, type ExportedTask } from '../export/exporter';
import { parseNotebookNotes, type ImportedNotebook } from './notebook-notes';

export interface ImportFile {
  path: string;
  bytes: Uint8Array;
}

export interface BlobPut {
  put(name: string, bytes: Uint8Array): Promise<string>;
}

export type ImportSource = 'notion' | 'obsidian' | 'markdown' | 'noesis';

/** A research source from a Noesis export, to be re-added through the ingestion pipeline. */
export interface PendingSource extends Omit<ExportedSource, 'file'> {
  file: ImportFile | null;
}

export interface ImportResult {
  rootId: string;
  source: ImportSource;
  pages: number;
  databases: number;
  images: number;
  tasks: number;
  /** Research sources (Noesis exports only); the caller re-ingests them. */
  sources: PendingSource[];
  notebooks: ImportedNotebook[];
  skipped: string[];
}

const NOTION_ID = /\s+[0-9a-f]{32}$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
const MAX_FILES = 20_000;
/** Decompressed size limits, so a crafted archive ("zip bomb") cannot exhaust memory. */
const MAX_ENTRY_BYTES = 300 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

const decoder = new TextDecoder();
const base = (p: string) => p.split('/').pop() ?? p;
const dir = (p: string) => p.split('/').slice(0, -1).join('/');
const stripExt = (n: string) => n.replace(/\.[^.]+$/, '');
/** "Meeting notes 0f3c…(32 hex)" → "Meeting notes" */
export const cleanName = (n: string) => stripExt(n).replace(NOTION_ID, '').trim() || 'Untitled';
const keyOf = (p: string) => decodeURIComponent(p).replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();

/** Expands zip archives (one nesting level: Notion wraps large exports in an outer zip). */
export async function expandInputs(files: ImportFile[]): Promise<ImportFile[]> {
  const out: ImportFile[] = [];
  let total = 0;
  const tooBig = () => new Error('This archive unpacks to more data than Noesis can import at once.');
  const expand = async (f: ImportFile, depth: number) => {
    if (/\.zip$/i.test(f.path) && depth < 2) {
      const zip = await JSZip.loadAsync(f.bytes);
      const entries = Object.values(zip.files).filter((e) => !e.dir && !/(^|\/)(__MACOSX|\.obsidian|\.trash)\//.test(e.name) && !base(e.name).startsWith('.'));
      if (entries.length > MAX_FILES) throw new Error('This archive has too many files to import at once.');
      // Sizes declared in the archive are checked before unpacking, actual sizes after.
      const sizeOf = (e: JSZip.JSZipObject) => (e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
      if (entries.some((e) => sizeOf(e) > MAX_ENTRY_BYTES) || entries.reduce((n, e) => n + sizeOf(e), 0) > MAX_TOTAL_BYTES - total) throw tooBig();
      for (const e of entries) {
        if (out.length > MAX_FILES) throw new Error('This archive has too many files to import at once.');
        const bytes = await e.async('uint8array');
        if (bytes.byteLength > MAX_ENTRY_BYTES) throw tooBig();
        if (!/\.zip$/i.test(e.name)) total += bytes.byteLength;
        if (total > MAX_TOTAL_BYTES) throw tooBig();
        await expand({ path: e.name.replace(/\\/g, '/'), bytes }, depth + 1);
      }
    } else out.push(f);
  };
  for (const f of files) await expand(f, 0);
  // Strip a shared top folder ("Export-1234/…", "MyVault/…") so the structure starts at its content.
  const tops = new Set(out.map((f) => (f.path.includes('/') ? f.path.split('/')[0] : '')));
  if (tops.size === 1 && !tops.has('') && !tops.has(DATA_DIR)) {
    const [top] = tops;
    for (const f of out) f.path = f.path.slice(top.length + 1);
  }
  return out;
}

function splitFrontMatter(md: string): { body: string; tags: string[] } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: md, tags: [] };
  const tags: string[] = [];
  const inline = m[1].match(/^tags:\s*\[(.*)\]\s*$/m);
  if (inline) tags.push(...inline[1].split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')));
  const block = m[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (block) tags.push(...block[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()));
  return { body: md.slice(m[0].length), tags: tags.filter(Boolean).map((t) => t.replace(/^#/, '')) };
}

function guessType(values: string[]): 'number' | 'checkbox' | 'url' | 'date' | 'text' {
  const filled = values.filter((v) => v.trim() !== '');
  if (!filled.length) return 'text';
  if (filled.every((v) => /^(yes|no|true|false)$/i.test(v.trim()))) return 'checkbox';
  if (filled.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))) return 'date';
  if (filled.every((v) => /^-?\d+([.,]\d+)?$/.test(v.trim()))) return 'number';
  if (filled.every((v) => /^https?:\/\/\S+$/i.test(v.trim()))) return 'url';
  return 'text';
}

export async function importWorkspace(
  repos: Repos,
  workspaceId: string,
  input: ImportFile[],
  opts: { blobs: BlobPut; rootTitle: (source: ImportSource) => string; onProgress?: (done: number, total: number) => void },
): Promise<ImportResult> {
  const files = await expandInputs(input);
  const isData = (f: ImportFile) => f.path.toLowerCase().startsWith(DATA_DIR.toLowerCase() + '/');
  const manifestFile = files.find((f) => keyOf(f.path) === keyOf(`${DATA_DIR}/manifest.json`));
  const manifest = manifestFile ? parseManifest(manifestFile.bytes) : null;
  const meta = new Map((manifest?.pages ?? []).map((p) => [keyOf(p.path), p]));
  const dataJson = <T,>(name: string, fallback: T): T => {
    const f = files.find((x) => keyOf(x.path) === keyOf(`${DATA_DIR}/${name}`));
    try {
      return f ? (JSON.parse(decoder.decode(f.bytes)) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const source: ImportSource = manifest ? 'noesis' : files.some((f) => NOTION_ID.test(stripExt(base(f.path))) || f.path.split('/').some((seg) => NOTION_ID.test(seg)))
    ? 'notion'
    : files.some((f) => /\[\[[^\]]+\]\]/.test(f.path.endsWith('.md') ? decoder.decode(f.bytes.subarray(0, 20_000)) : ''))
      ? 'obsidian'
      : 'markdown';
  // "Noesis data/" holds tasks, sources and files of a Noesis export, not pages.
  const notes = files.filter((f) => /\.md$/i.test(f.path) && !(manifest && isData(f)));
  const csvs = files.filter((f) => /\.csv$/i.test(f.path) && !/_all\.csv$/i.test(f.path) && !(manifest && isData(f)));
  const images = new Map(files.filter((f) => IMAGE_EXT.test(f.path)).map((f) => [keyOf(f.path), f]));
  const imagesByName = new Map(files.filter((f) => IMAGE_EXT.test(f.path)).map((f) => [base(f.path).toLowerCase(), f]));
  const skipped = files.filter((f) => !/\.(md|csv)$/i.test(f.path) && !IMAGE_EXT.test(f.path) && !(manifest && isData(f))).map((f) => f.path);
  if (!notes.length && !csvs.length && !manifest) throw new Error('No Markdown (.md) or CSV files were found. Export from Notion as “Markdown & CSV”, or choose an Obsidian vault folder zip.');

  const root = await repos.pages.create({ workspaceId, title: opts.rootTitle(source), icon: '📥' });
  const pageByPath = new Map<string, string>(); // key of .md / .csv path → page id
  const pageByFolder = new Map<string, string>(); // folder key → page id that owns it
  const pageByTitle = new Map<string, string>(); // lower-case title → page id (wikilinks)

  // Folder pages for directories that have no page of their own (Obsidian folders).
  const ensureFolder = async (folder: string): Promise<string> => {
    if (!folder) return root.id;
    const k = keyOf(folder);
    const existing = pageByFolder.get(k);
    if (existing) return existing;
    const parent = await ensureFolder(dir(folder));
    // Notion: "Parent <id>.md" owns "Parent <id>/".
    const owner = pageByPath.get(k + '.md');
    if (owner) {
      pageByFolder.set(k, owner);
      return owner;
    }
    const page = await repos.pages.create({ workspaceId, parentId: parent, title: cleanName(base(folder)), icon: '📁' });
    pageByFolder.set(k, page.id);
    return page.id;
  };

  // Pass 1: create every page/database (shallow paths first so parents exist).
  const ordered = [...notes, ...csvs].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  let databases = 0;
  for (const f of ordered) {
    const parentId = await ensureFolder(dir(f.path));
    const found = meta.get(keyOf(f.path));
    const known = found && {
      title: String(found.title ?? '').slice(0, 500),
      // Icons are emoji; anything long is not one.
      icon: typeof found.icon === 'string' && found.icon.length <= 16 ? found.icon : null,
    };
    const title = known?.title || cleanName(base(f.path));
    if (/\.csv$/i.test(f.path)) {
      const db = await repos.databases.createDatabase(workspaceId, title, parentId);
      if (known?.icon) await repos.pages.updateMeta(db.id, { icon: known.icon });
      pageByPath.set(keyOf(f.path), db.id);
      databases++;
    } else {
      const page = await repos.pages.create({ workspaceId, parentId, title, icon: known?.icon ?? null });
      pageByPath.set(keyOf(f.path), page.id);
      if (!pageByTitle.has(title.toLowerCase())) pageByTitle.set(title.toLowerCase(), page.id);
    }
  }

  // Pass 2: content, links, images, tags, database rows.
  let imageCount = 0;
  const storeImage = async (f: ImportFile) => {
    const key = await opts.blobs.put(base(f.path), f.bytes);
    const ext = base(f.path).split('.').pop()!.toLowerCase();
    const att = await repos.attachments.create({
      workspace_id: workspaceId,
      file_name: base(f.path),
      mime: ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      size: f.bytes.byteLength,
      storage_key: key,
      sha256: await sha256Hex(f.bytes),
    });
    imageCount++;
    return `attachment:${att.id}`;
  };
  const imageCache = new Map<ImportFile, Promise<string>>();
  const imageSrc = (f: ImportFile) => {
    if (!imageCache.has(f)) imageCache.set(f, storeImage(f));
    return imageCache.get(f)!;
  };

  let done = 0;
  for (const f of notes) {
    const id = pageByPath.get(keyOf(f.path))!;
    const title = cleanName(base(f.path));
    const { body, tags } = splitFrontMatter(decoder.decode(f.bytes));
    let md = body.replace(/^﻿/, '');
    // Noesis exports start with the title as H1; Notion repeats the title as the first heading.
    if (manifest) md = md.replace(/^\s*#\s+.*\n/, '');
    else md = md.replace(new RegExp(`^\\s*#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'i'), '');

    // Obsidian embeds ![[image.png]] and wikilinks [[Page]] / [[Page|alias]] / [[Page#heading]].
    const pending: Promise<void>[] = [];
    const replacements = new Map<string, string>();
    md = md.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (m, target: string) => {
      const img = imagesByName.get(base(target.trim()).toLowerCase());
      if (!img) return m;
      const token = `@@img${replacements.size}@@`;
      pending.push(imageSrc(img).then((src) => void replacements.set(token, `![${base(target)}](${src})`)));
      return token;
    });
    md = md.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
      const pid = pageByTitle.get(cleanName(base(target.trim())).toLowerCase());
      return pid ? `[${(alias ?? target).trim()}](${PAGE_LINK_PREFIX}${pid})` : (alias ?? target);
    });
    // Markdown links/images to files inside the export (Notion encodes spaces as %20).
    md = md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, bang: string, text: string, href: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return m; // external or already internal
      const target = keyOf([dir(f.path), href].filter(Boolean).join('/').replace(/\/\.\//g, '/'));
      const resolved = target.split('/').reduce<string[]>((acc, part) => (part === '..' ? acc.slice(0, -1) : [...acc, part]), []).join('/');
      if (bang) {
        const img = images.get(resolved) ?? imagesByName.get(base(resolved));
        if (!img) return m;
        const token = `@@img${replacements.size}@@`;
        pending.push(imageSrc(img).then((src) => void replacements.set(token, `![${text}](${src})`)));
        return token;
      }
      const pid = pageByPath.get(resolved);
      return pid ? `[${text}](${PAGE_LINK_PREFIX}${pid})` : m;
    });
    await Promise.all(pending);
    for (const [token, value] of replacements) md = md.replace(token, value);

    if (md.trim()) await repos.pages.saveContent(id, htmlToDoc(markdownToHtml(md)));
    for (const tag of tags.slice(0, 20)) await repos.pages.addTag(id, tag);
    opts.onProgress?.(++done, notes.length + csvs.length);
  }

  for (const f of csvs) {
    const dbId = pageByPath.get(keyOf(f.path))!;
    const rows = parseCsv(decoder.decode(f.bytes).replace(/^﻿/, ''));
    const [header, ...data] = rows;
    if (header?.length) {
      const props = await repos.databases.properties(dbId);
      const titleProp = props.find((p) => p.type === 'title')!;
      // The default "Status" column only makes sense if the CSV has one; drop it otherwise.
      const status = props.find((p) => p.type === 'status');
      if (status && !header.some((h) => h.trim().toLowerCase() === 'status')) await repos.databases.removeProperty(status.id);
      const columnProps: (string | null)[] = [titleProp.id];
      let statusCol = -1;
      for (let c = 1; c < header.length; c++) {
        const name = header[c].trim() || `Column ${c + 1}`;
        // A "Status" column fills the database's own status property instead of adding a second one.
        if (status && statusCol < 0 && name.toLowerCase() === 'status') {
          statusCol = c;
          columnProps.push(status.id);
          continue;
        }
        const type = guessType(data.map((r) => r[c] ?? ''));
        columnProps.push((await repos.databases.addProperty(dbId, name, type)).id);
      }
      const types = await repos.databases.properties(dbId);
      for (const r of data.slice(0, 50_000)) {
        if (r.every((v) => !v.trim())) continue;
        const values: Record<string, string | number | boolean | null> = {};
        r.forEach((v, c) => {
          const pid = columnProps[c];
          if (!pid) return;
          const type = types.find((p) => p.id === pid)?.type;
          // Noesis exports prefix spreadsheet-formula-like cells with ' (see exporter); undo that.
          const raw = manifest ? v.trim().replace(/^'(?=[=+\-@\t\r])/, '') : v.trim();
          if (c === statusCol) return; // set below through the option list
          values[pid] = type === 'number' ? (raw ? Number(raw.replace(',', '.')) : null) : type === 'checkbox' ? /^(yes|true)$/i.test(raw) : raw;
        });
        if (statusCol > 0 && status && r[statusCol]?.trim()) values[status.id] = (await repos.databases.ensureOption(status.id, r[statusCol].trim())).id;
        await repos.databases.addRow(dbId, values);
      }
    }
    opts.onProgress?.(++done, notes.length + csvs.length);
  }

  // Tasks of a Noesis export: parents first, project links follow the page paths.
  let taskCount = 0;
  if (manifest) {
    const raw = dataJson<unknown>('tasks.json', []);
    const list = (Array.isArray(raw) ? raw : []).filter((t): t is ExportedTask => !!t && typeof t === 'object' && typeof (t as ExportedTask).ref === 'string').slice(0, 50_000);
    const newId = new Map<string, string>();
    const pendingTasks = [...list];
    for (let guard = 0; pendingTasks.length && guard < 1000; guard++) {
      const ready = pendingTasks.filter((t) => !t.parent || newId.has(t.parent) || !list.some((x) => x.ref === t.parent));
      if (!ready.length) break;
      for (const t of ready) {
        // tasks.json is user-editable: keep every value inside what the database accepts.
        const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        const task = await repos.tasks.create({
          workspaceId,
          title: String(t.title ?? '').slice(0, 500) || 'Task',
          notes: String(t.notes ?? '').slice(0, 100_000),
          parentId: t.parent ? (newId.get(t.parent) ?? null) : null,
          projectPageId: typeof t.project === 'string' ? (pageByPath.get(keyOf(t.project)) ?? null) : null,
          priority: Math.min(3, Math.max(0, Math.round(Number(t.priority)) || 0)),
          dueAt: time(t.due_at),
          remindAt: time(t.remind_at),
          recurrence: (['daily', 'weekly', 'monthly', 'yearly'] as const).find((r) => r === t.recurrence) ?? null,
          status: (['todo', 'in_progress', 'done', 'cancelled'] as const).find((x) => x === t.status) ?? 'todo',
        });
        newId.set(t.ref, task.id);
        taskCount++;
        pendingTasks.splice(pendingTasks.indexOf(t), 1);
      }
    }
  }
  const byPath = new Map(files.map((f) => [keyOf(f.path), f]));
  const sources: PendingSource[] = manifest
    ? (() => {
        const raw = dataJson<unknown>('sources.json', []);
        return (Array.isArray(raw) ? raw : [])
          .filter((x): x is ExportedSource => !!x && typeof x === 'object')
          .slice(0, 10_000)
          .map((x) => ({
            ref: typeof x.ref === 'string' ? x.ref.slice(0, 200) : undefined,
            title: String(x.title ?? '').slice(0, 500),
            kind: String(x.kind ?? ''),
            origin: String(x.origin ?? '').slice(0, 4000),
            text: typeof x.text === 'string' ? x.text : null,
            file: typeof x.file === 'string' ? (byPath.get(keyOf(x.file)) ?? null) : null,
          }));
      })()
    : [];

  const notebooks = manifest ? parseNotebookNotes(dataJson<unknown>('notebooks.json', [])) : [];
  return { rootId: root.id, source, pages: notes.length, databases, images: imageCount, tasks: taskCount, sources, notebooks, skipped };
}

function parseManifest(bytes: Uint8Array): ExportManifest | null {
  try {
    const m = JSON.parse(decoder.decode(bytes)) as ExportManifest;
    return m?.format === EXPORT_FORMAT ? m : null;
  } catch {
    return null;
  }
}
