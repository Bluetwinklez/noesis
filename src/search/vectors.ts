/**
 * Offline vector utilities.
 *
 * `localHashEmbed` is a feature-hashing embedding (word unigrams + character
 * trigrams). It is NOT a neural semantic model: it captures lexical and
 * morphological similarity (useful for Turkish suffixes) and keeps "semantic"
 * search usable offline. When a provider embedding model is configured the
 * neural vectors are used instead.
 */
export const LOCAL_EMBED_MODEL = 'local-hash-512';
const DIM = 512;

const STOP = new Set(
  'the a an and or of to in on for is are was were be been with as at by it this that from ve ile bir bu da de için olarak olan çok gibi daha ama veya ki ne'.split(
    ' ',
  ),
);

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function tokenizeWords(text: string): string[] {
  return text
    .toLocaleLowerCase('tr')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

export function localHashEmbed(text: string): number[] {
  const v = new Float32Array(DIM);
  const words = tokenizeWords(text);
  for (const w of words) {
    const h = fnv1a(w);
    v[h % DIM] += h & 0x80000000 ? -1 : 1;
    const padded = `#${w}#`;
    for (let i = 0; i + 3 <= padded.length; i++) {
      const g = fnv1a(padded.slice(i, i + 3));
      v[g % DIM] += (g & 0x80000000 ? -1 : 1) * 0.5;
    }
  }
  return normalize(Array.from(v));
}

export function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n === 0 ? v : v.map((x) => x / n);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Reciprocal rank fusion of several ranked id lists. */
export function rrf<T extends string | number>(lists: T[][], k = 60): Map<T, number> {
  const scores = new Map<T, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return scores;
}
