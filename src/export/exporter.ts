/**
 * Full workspace export to an open format: one .zip with every page as Markdown
 * (folders follow the page tree), databases as CSV, images and attachments as
 * files, plus tasks and research sources under "Noesis data/". Links between
 * pages and to images are relative paths, so the archive reads well in any
 * Markdown tool and imports back into Noesis (see importer.ts).
 */
import JSZip from 'jszip';
import type { Repos } from '../core/store';
import type { CellValue, DbProperty, Page, Task } from '../core/types';
import { PAGE_LINK_PREFIX, type DocNode } from '../core/doc';
import { docToHtml } from '../editor/serialize';
import { htmlToMarkdown } from '../editor/markdown';
import { computedValue, displayValue, rowTitle } from '../core/repos/databases';
import { parseJson } from '../lib/util';

export const DATA_DIR = 'Noesis data';
export const EXPORT_FORMAT = 'noesis-export';

export interface BlobGet {
  get(key: string): Promise<Uint8Array>;
}

/** Task as stored in tasks.json; pages are referenced by their path inside the archive. */
export interface ExportedTask {
  ref: string;
  parent: string | null;
  project: string | null;
  title: string;
  notes: string;
  status: Task['status'];
  priority: number;
  due_at: number | null;
  remind_at: number | null;
  recurrence: Task['recurrence'];
}

export interface ExportedSource {
  title: string;
  kind: string;
  origin: string;
  /** Original file inside the archive, when the source was a file. */
  file: string | null;
  /** Extracted text (also written as Markdown for reading). */
  text: string | null;
}

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  version: 1;
  app: string;
  workspace: string;
  exported_at: string;
  counts: { pages: number; databases: number; files: number; tasks: number; sources: number };
  /** Exact titles and icons (file names cannot hold every character). */
  pages: { path: string; title: string; icon: string | null }[];
}

const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;
/** Windows-safe file name (also avoids reserved names and trailing dots). */
export function safeName(name: string, fallback = 'Untitled'): string {
  let n = name.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120);
  if (!n) n = fallback;
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `_${n}`;
  return n;
}

/** Relative link from a file in `fromDir` to `toPath`, URL-encoded per segment. */
export function relLink(fromDir: string, toPath: string): string {
  const from = fromDir ? fromDir.split('/') : [];
  const to = toPath.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].map((seg) => encodeURIComponent(seg).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function exportWorkspace(
  repos: Repos,
  workspaceId: string,
  blobs: BlobGet,
  opts: { appVersion?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ bytes: Uint8Array; manifest: ExportManifest }> {
  const zip = new JSZip();
  const workspace = (await repos.workspaces.list()).find((w) => w.id === workspaceId);
  const pages = await repos.pages.listAllLive(workspaceId);
  const byParent = new Map<string | null, Page[]>();
  const ids = new Set(pages.map((p) => p.id));
  for (const p of pages) {
    const parent = p.parent_id && ids.has(p.parent_id) ? p.parent_id : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), p]);
  }

  // 1. Paths: "Parent.md" owns the folder "Parent/" with its children.
  const pathOf = new Map<string, string>(); // page id → file path (.md or .csv)
  const taken = new Set<string>([DATA_DIR.toLowerCase()]);
  const assign = (parentId: string | null, dir: string) => {
    for (const p of byParent.get(parentId) ?? []) {
      const ext = p.kind === 'database' ? 'csv' : 'md';
      let name = safeName(p.title);
      for (let n = 2; taken.has(`${dir}${name}`.toLowerCase()); n++) name = `${safeName(p.title)} (${n})`;
      taken.add(`${dir}${name}`.toLowerCase());
      pathOf.set(p.id, `${dir}${name}.${ext}`);
      assign(p.id, `${dir}${name}/`);
    }
  };
  assign(null, '');

  // 2. Files: every attachment once; originals of research sources go next to the sources.
  // The list omits extracted text; load each source in full, oldest first (import keeps that order).
  const sources = (await Promise.all((await repos.sources.list(workspaceId)).reverse().map((x) => repos.sources.get(x.id)))).filter(
    (x): x is NonNullable<typeof x> => !!x,
  );
  const sourceFileIds = new Set(sources.map((s) => s.attachment_id).filter((x): x is string => !!x));
  const attachments = await repos.attachments.list(workspaceId);
  const fileOf = new Map<string, string>();
  const usedFiles = new Set<string>();
  for (const a of attachments) {
    const folder = sourceFileIds.has(a.id) ? `${DATA_DIR}/source-files` : `${DATA_DIR}/attachments`;
    let name = safeName(a.file_name, 'file');
    for (let n = 2; usedFiles.has(`${folder}/${name}`.toLowerCase()); n++) name = safeName(a.file_name, 'file').replace(/(\.[^.]+)?$/, ` (${n})$1`);
    usedFiles.add(`${folder}/${name}`.toLowerCase());
    try {
      zip.file(`${folder}/${name}`, await blobs.get(a.storage_key));
      fileOf.set(a.id, `${folder}/${name}`);
    } catch {
      // A missing blob must not abort the whole export; the link stays as text.
    }
  }

  // 3. Pages as Markdown, links rewritten to relative paths.
  let done = 0;
  const total = pages.length;
  let databases = 0;
  for (const p of pages) {
    const path = pathOf.get(p.id)!;
    const dir = path.slice(0, path.lastIndexOf('/') + 1).replace(/\/$/, '');
    if (p.kind === 'database') {
      zip.file(path, '﻿' + (await databaseCsv(repos, p.id)));
      databases++;
    } else {
      const doc = parseJson<DocNode | null>(p.content_json ?? 'null', null);
      let md = doc ? htmlToMarkdown(docToHtml(doc)) : '';
      md = md.replace(/\]\((noesis:\/\/page\/|attachment:)([^)\s]+)\)/g, (m, scheme: string, id: string) => {
        const target = scheme === PAGE_LINK_PREFIX ? pathOf.get(id) : fileOf.get(id);
        return target ? `](${relLink(dir, target)})` : m;
      });
      const tags = (await repos.pages.pageTags(p.id)).map((t) => t.name);
      const front = [tags.length && `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`].filter(Boolean);
      zip.file(path, `${front.length ? `---\n${front.join('\n')}\n---\n` : ''}# ${p.title || 'Untitled'}\n\n${md.trim()}\n`);
    }
    opts.onProgress?.(++done, total);
  }

  // 4. Tasks (structured for re-import, readable checklist for people).
  const tasks = await repos.tasks.list(workspaceId);
  const exported: ExportedTask[] = tasks.map((t) => ({
    ref: t.id,
    parent: t.parent_id,
    project: t.project_page_id ? (pathOf.get(t.project_page_id) ?? null) : null,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
    due_at: t.due_at,
    remind_at: t.remind_at,
    recurrence: t.recurrence,
  }));
  zip.file(`${DATA_DIR}/tasks.json`, JSON.stringify(exported, null, 2));
  const date = (ms: number | null) => (ms ? ` (${new Date(ms).toISOString().slice(0, 10)})` : '');
  const taskLines = (parent: string | null, depth: number): string[] =>
    tasks
      .filter((t) => t.parent_id === parent)
      .flatMap((t) => [`${'  '.repeat(depth)}- [${t.status === 'done' ? 'x' : ' '}] ${t.title}${date(t.due_at)}`, ...taskLines(t.id, depth + 1)]);
  zip.file(`${DATA_DIR}/Tasks.md`, `# Tasks\n\n${taskLines(null, 0).join('\n')}\n`);

  // 5. Research sources: originals, extracted text and a list for re-import.
  const exportedSources: ExportedSource[] = [];
  const usedNotes = new Set<string>();
  for (const s of sources) {
    const file = s.attachment_id ? (fileOf.get(s.attachment_id) ?? null) : null;
    exportedSources.push({ title: s.title, kind: s.kind, origin: s.origin, file, text: file ? null : s.text_content || null });
    if (s.text_content) {
      let name = safeName(s.title, 'Source');
      for (let n = 2; usedNotes.has(name.toLowerCase()); n++) name = `${safeName(s.title, 'Source')} (${n})`;
      usedNotes.add(name.toLowerCase());
      zip.file(`${DATA_DIR}/Sources/${name}.md`, `# ${s.title}\n\n> ${s.origin}\n\n${s.text_content}\n`);
    }
  }
  zip.file(`${DATA_DIR}/sources.json`, JSON.stringify(exportedSources, null, 2));

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    version: 1,
    app: opts.appVersion ?? '',
    workspace: workspace?.name ?? '',
    exported_at: new Date().toISOString(),
    counts: { pages: pages.length - databases, databases, files: fileOf.size, tasks: tasks.length, sources: sources.length },
    pages: pages.map((p) => ({ path: pathOf.get(p.id)!, title: p.title, icon: p.icon })),
  };
  zip.file(`${DATA_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, manifest };
}

/** Database rows as CSV: title column first, values as people read them (dates as YYYY-MM-DD). */
async function databaseCsv(repos: Repos, databaseId: string): Promise<string> {
  const props = await repos.databases.properties(databaseId);
  const rows = await repos.databases.rows(databaseId);
  const related = await repos.databases.relatedData(props);
  const ordered = [...props.filter((p) => p.type === 'title'), ...props.filter((p) => p.type !== 'title')];
  const cell = (p: DbProperty, v: CellValue): string => {
    if (v === null || v === undefined) return '';
    switch (p.type) {
      case 'checkbox':
        return v ? 'Yes' : 'No';
      case 'date':
        return typeof v === 'string' ? v.slice(0, 10) : '';
      case 'relation': {
        const target = p.options.relationDatabaseId ? related.get(p.options.relationDatabaseId) : undefined;
        return (Array.isArray(v) ? v : [])
          .map((id) => {
            const r = target?.rows.get(id);
            return r ? rowTitle(target!.props, r) : '';
          })
          .filter(Boolean)
          .join(', ');
      }
      case 'select':
      case 'status':
      case 'multi_select':
        return displayValue(p, v);
      default:
        return String(v);
    }
  };
  const lines = [ordered.map((p) => csvCell(p.name)).join(',')];
  for (const r of rows) lines.push(ordered.map((p) => csvCell(cell(p, computedValue(p, r, props, related)))).join(','));
  return lines.join('\r\n') + '\r\n';
}
