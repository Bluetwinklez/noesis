import DOMPurify from 'dompurify';
import type { SourceKind } from '../core/types';
import { normalizeText, type PageText } from './chunker';

export class IngestionError extends Error {
  constructor(
    message: string,
    public readonly stage: 'validation' | 'extraction',
    public readonly code: 'unsupported' | 'too_large' | 'empty' | 'corrupt' | 'requires_provider' | 'network' | 'blocked' = 'corrupt',
  ) {
    super(message);
  }
}

export interface ExtractResult {
  pages: PageText[];
  pageCount: number | null;
  metadata: Record<string, unknown>;
  title?: string;
}

export const MAX_SOURCE_BYTES = 80 * 1024 * 1024;

const EXT_KIND: Record<string, SourceKind> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  text: 'txt',
  log: 'txt',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  csv: 'csv',
  tsv: 'csv',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  webm: 'audio',
};

export function detectKind(fileName: string): SourceKind | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_KIND[ext] ?? null;
}

export const ACCEPTED_FILE_TYPES = Object.keys(EXT_KIND)
  .map((e) => '.' + e)
  .join(',');

function startsWith(bytes: Uint8Array, sig: number[]) {
  return sig.every((b, i) => bytes[i] === b);
}

/** Validates magic numbers so a renamed file is not parsed with the wrong parser. */
export function validateBytes(kind: SourceKind, bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new IngestionError('The file is empty.', 'validation', 'empty');
  if (bytes.byteLength > MAX_SOURCE_BYTES)
    throw new IngestionError(`The file exceeds the ${MAX_SOURCE_BYTES / 1024 / 1024} MB import limit.`, 'validation', 'too_large');
  if (kind === 'pdf' && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46]))
    throw new IngestionError('This file does not look like a PDF (missing %PDF header).', 'validation', 'corrupt');
  if (kind === 'docx' && !startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]))
    throw new IngestionError('This file does not look like a DOCX document (not a ZIP container).', 'validation', 'corrupt');
  if (kind === 'image') {
    const ok =
      startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ||
      startsWith(bytes, [0xff, 0xd8, 0xff]) ||
      startsWith(bytes, [0x47, 0x49, 0x46]) ||
      (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57);
    if (!ok) throw new IngestionError('Unsupported or corrupted image file.', 'validation', 'corrupt');
  }
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Many Turkish legacy files are Windows-1254; fall back when UTF-8 has replacement chars.
  if (utf8.includes('�')) {
    try {
      return new TextDecoder('windows-1254').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8.replace(/^﻿/, '');
}

export function extractPlainText(bytes: Uint8Array): ExtractResult {
  return { pages: [{ pageNumber: null, text: normalizeText(decodeText(bytes)) }], pageCount: null, metadata: {} };
}

export function extractMarkdown(bytes: Uint8Array): ExtractResult {
  const text = decodeText(bytes);
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return { pages: [{ pageNumber: null, text: normalizeText(text) }], pageCount: null, metadata: {}, title };
}

/** Sanitises untrusted HTML and returns readable text (scripts/styles removed). */
export function htmlToText(html: string): { text: string; title?: string } {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'svg', 'form'],
    RETURN_DOM: true,
  }) as unknown as HTMLElement;
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const blockTags = new Set(['P', 'DIV', 'BR', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE', 'TABLE']);
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) parts.push(n.textContent ?? '');
    else if (n.nodeType === 1) {
      const el = n as Element;
      // Page chrome is noise for retrieval.
      if (['TITLE', 'HEAD', 'NAV', 'FOOTER', 'ASIDE'].includes(el.tagName)) return;
      if (blockTags.has(el.tagName)) parts.push('\n');
      el.childNodes.forEach(walk);
      if (blockTags.has(el.tagName)) parts.push('\n');
    }
  };
  walk(clean);
  return { text: normalizeText(parts.join('')), title: titleMatch?.[1]?.trim() || undefined };
}

export function extractHtml(bytes: Uint8Array): ExtractResult {
  const { text, title } = htmlToText(decodeText(bytes));
  return { pages: [{ pageNumber: null, text }], pageCount: null, metadata: {}, title };
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? (text.split('\n')[0].split('\t').length > text.split('\n')[0].split(',').length ? '\t' : text.split('\n')[0].includes(';') && !text.split('\n')[0].includes(',') ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** CSV rows become "Header: value" records so each row is retrievable on its own. */
export function extractCsv(bytes: Uint8Array): ExtractResult {
  const rows = parseCsv(decodeText(bytes));
  if (!rows.length) throw new IngestionError('The CSV file contains no rows.', 'extraction', 'empty');
  const [header, ...body] = rows;
  const lines = body.map((r, i) => `Row ${i + 1}: ` + header.map((h, j) => `${h.trim() || `Column ${j + 1}`}: ${r[j] ?? ''}`).join('; '));
  return {
    pages: [{ pageNumber: null, text: [`Columns: ${header.join(', ')}`, ...lines].join('\n\n') }],
    pageCount: null,
    metadata: { rows: body.length, columns: header.length, header },
  };
}

// pdf.js is injected so the browser build can use its worker and Node tests can use the legacy build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfJs = { getDocument: (src: any) => { promise: Promise<any> } };
let pdfjsLoader: (() => Promise<PdfJs>) | null = null;
export function setPdfJsLoader(loader: () => Promise<PdfJs>) {
  pdfjsLoader = loader;
}
export function getPdfJsLoader() {
  return pdfjsLoader;
}

export async function extractPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<ExtractResult> {
  if (!pdfjsLoader) throw new IngestionError('PDF support is not initialised.', 'extraction', 'unsupported');
  const pdfjs = await pdfjsLoader();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/password/i.test(msg)) throw new IngestionError('This PDF is password-protected. Remove the password and import it again.', 'extraction', 'blocked');
    throw new IngestionError(`The PDF could not be read: ${msg || 'invalid structure'}.`, 'extraction', 'corrupt');
  }
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    let lastY: number | null = null;
    for (const item of content.items as { str?: string; transform?: number[]; hasEOL?: boolean }[]) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) text += '\n';
      text += item.str;
      if (item.hasEOL) text += '\n';
      lastY = y;
    }
    pages.push({ pageNumber: i, text: normalizeText(text) });
    page.cleanup?.();
  }
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, unknown>;
  await doc.destroy?.();
  const totalText = pages.reduce((n, p) => n + p.text.length, 0);
  if (totalText < 20)
    throw new IngestionError(
      'No selectable text was found in this PDF and it could not be read with OCR.',
      'extraction',
      'empty',
    );
  return {
    pages,
    pageCount: pages.length,
    metadata: { author: info.Author ?? null, producer: info.Producer ?? null },
    title: typeof info.Title === 'string' && info.Title.trim() ? info.Title.trim() : undefined,
  };
}

export async function extractDocx(bytes: Uint8Array): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  let value: string;
  let messages: { message: string }[] = [];
  try {
    const NodeBuffer = (globalThis as { Buffer?: unknown }).Buffer;
    const input = NodeBuffer
      ? ({ buffer: (globalThis as unknown as { Buffer: { from(b: Uint8Array): unknown } }).Buffer.from(bytes) } as never)
      : ({ arrayBuffer: bytes.slice().buffer } as never);
    const r = await mammoth.extractRawText(input);
    value = r.value;
    messages = r.messages ?? [];
  } catch (e) {
    throw new IngestionError(`The DOCX document could not be read: ${(e as Error).message}`, 'extraction', 'corrupt');
  }
  const text = normalizeText(value);
  if (!text) throw new IngestionError('The DOCX document contains no text.', 'extraction', 'empty');
  return { pages: [{ pageNumber: null, text }], pageCount: null, metadata: { warnings: messages.map((m) => m.message).slice(0, 10) } };
}

export function isYouTubeUrl(url: string) {
  return /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch|shorts|live)|youtu\.be\/)/i.test(url);
}

export function validateUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new IngestionError('Enter a valid web address starting with http:// or https://', 'validation', 'unsupported');
  }
  if (!/^https?:$/.test(u.protocol)) throw new IngestionError('Only http and https links can be imported.', 'validation', 'unsupported');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '[::1]')
    throw new IngestionError('Links to local or private network addresses are blocked for safety.', 'validation', 'blocked');
  return u;
}
