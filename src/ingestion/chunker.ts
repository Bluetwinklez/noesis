export interface PageText {
  pageNumber: number | null;
  text: string;
}

export interface Chunk {
  text: string;
  pageNumber: number | null;
  charStart: number;
  charEnd: number;
}

export interface ChunkOptions {
  targetChars?: number;
  overlapChars?: number;
}

/** Normalises whitespace while keeping paragraph breaks. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splits pages into overlapping chunks on paragraph / sentence boundaries.
 * Offsets refer to the concatenated document text (pages joined by "\n\n"),
 * which is exactly what is stored in sources.text_content.
 */
export function chunkPages(pages: PageText[], opts: ChunkOptions = {}): { fullText: string; chunks: Chunk[] } {
  const target = opts.targetChars ?? 1000;
  const overlap = Math.min(opts.overlapChars ?? 150, Math.floor(target / 3));
  const chunks: Chunk[] = [];
  let fullText = '';

  for (const page of pages) {
    const text = page.text;
    if (!text.trim()) continue;
    if (fullText) fullText += '\n\n';
    const base = fullText.length;
    fullText += text;

    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + target);
      if (end < text.length) {
        // Prefer a paragraph break, then a sentence end, then whitespace.
        const window = text.slice(start + Math.floor(target * 0.5), end);
        const para = window.lastIndexOf('\n\n');
        const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('.\n'));
        const space = window.lastIndexOf(' ');
        const cut = para >= 0 ? para + 2 : sentence >= 0 ? sentence + 2 : space >= 0 ? space + 1 : -1;
        if (cut > 0) end = start + Math.floor(target * 0.5) + cut;
      }
      const piece = text.slice(start, end);
      const lead = piece.length - piece.trimStart().length;
      const trimmed = piece.trim();
      if (trimmed) {
        chunks.push({
          text: trimmed,
          pageNumber: page.pageNumber,
          charStart: base + start + lead,
          charEnd: base + start + lead + trimmed.length,
        });
      }
      if (end >= text.length) break;
      let next = end - overlap;
      // Start the overlap at a word boundary.
      const sp = text.indexOf(' ', next);
      if (sp > 0 && sp < end) next = sp + 1;
      start = Math.max(next, start + 1);
    }
  }
  return { fullText, chunks };
}
