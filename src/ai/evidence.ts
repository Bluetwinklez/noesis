export interface TextRange { start: number; end: number }

/** A citation-presence heuristic, not a factuality or entailment detector. */
export function uncitedSentenceRanges(text: string, validNumbers: ReadonlySet<number>, lang = 'en'): TextRange[] {
  const out: TextRange[] = [];
  let consumed = 0;
  const segments = new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text);
  for (const segment of segments) {
    const start = Math.max(consumed, segment.index);
    let end = segment.index + segment.segment.length;
    // Models often place the reference after the full stop, in the next segment.
    const trailing = text.slice(end).match(/^(?:\s*(?:\[\d+\]|@@NOESIS_CITE\d+@@))+/);
    if (trailing) end += trailing[0].length;
    consumed = Math.max(consumed, end);
    if (end <= start) continue;
    const sentence = text.slice(start, end);
    const cited = [...sentence.matchAll(/\[(\d+)\]|@@NOESIS_CITE(\d+)@@/g)].some((m) => validNumbers.has(Number(m[1] ?? m[2])));
    if (/\p{L}/u.test(sentence.replace(/@@NOESIS_CITE\d+@@/g, '')) && !cited) out.push({ start, end });
  }
  return out;
}
