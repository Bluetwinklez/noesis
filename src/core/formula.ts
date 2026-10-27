/**
 * A small, safe formula language for database properties (no eval).
 * Supports numbers, strings, booleans, + - * / %, comparisons, && || !,
 * prop("Name"), and functions: if, concat, length, round, floor, ceil, abs,
 * min, max, upper, lower, contains, now, dateBetween(days).
 */
import type { CellValue } from './types';

type Val = number | string | boolean | null | string[];
type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'lp' | 'rp' | 'comma'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ t: 'num', v: src.slice(i, j) });
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (j >= src.length) throw new Error('Unterminated string');
      out.push({ t: 'str', v: s });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
    } else if (c === '(') {
      out.push({ t: 'lp', v: c });
      i++;
    } else if (c === ')') {
      out.push({ t: 'rp', v: c });
      i++;
    } else if (c === ',') {
      out.push({ t: 'comma', v: c });
      i++;
    } else {
      const two = src.slice(i, i + 2);
      if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
        out.push({ t: 'op', v: two });
        i += 2;
      } else if ('+-*/%<>!'.includes(c)) {
        out.push({ t: 'op', v: c });
        i++;
      } else throw new Error(`Unexpected character "${c}"`);
    }
  }
  return out;
}

const num = (v: Val): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`"${v}" is not a number`);
  return n;
};
const str = (v: Val): string => (v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v));
const truthy = (v: Val): boolean => (Array.isArray(v) ? v.length > 0 : !!v);

export function evaluateFormula(
  expr: string,
  lookup: (name: string) => CellValue,
): { ok: true; value: CellValue } | { ok: false; error: string } {
  if (!expr.trim()) return { ok: true, value: null };
  try {
    const toks = tokenize(expr);
    let p = 0;
    let depth = 0;
    const peek = () => toks[p];
    const eat = (t?: Tok['t'], v?: string) => {
      const tok = toks[p];
      if (!tok || (t && tok.t !== t) || (v && tok.v !== v)) throw new Error(`Expected ${v ?? t ?? 'token'}`);
      p++;
      return tok;
    };
    const binary = (next: () => Val, ops: string[], apply: (op: string, a: Val, b: Val) => Val) => () => {
      let left = next();
      while (peek()?.t === 'op' && ops.includes(peek().v)) {
        const op = eat().v;
        left = apply(op, left, next());
      }
      return left;
    };
    const primary = (): Val => {
      if (++depth > 64) throw new Error('Formula too deeply nested');
      try {
        const tok = peek();
        if (!tok) throw new Error('Unexpected end of formula');
        if (tok.t === 'num') return eat() && Number(tok.v);
        if (tok.t === 'str') return eat() && tok.v;
        if (tok.t === 'lp') {
          eat('lp');
          const v = or();
          eat('rp');
          return v;
        }
        if (tok.t === 'op' && (tok.v === '-' || tok.v === '!')) {
          eat();
          const v = primary();
          return tok.v === '-' ? -num(v) : !truthy(v);
        }
        if (tok.t === 'id') {
          eat();
          const name = tok.v.toLowerCase();
          if (name === 'true') return true;
          if (name === 'false') return false;
          eat('lp');
          const args: Val[] = [];
          if (peek()?.t !== 'rp') {
            args.push(or());
            while (peek()?.t === 'comma') {
              eat('comma');
              args.push(or());
            }
          }
          eat('rp');
          return call(name, args);
        }
        throw new Error(`Unexpected "${tok.v}"`);
      } finally {
        depth--;
      }
    };
    const call = (name: string, a: Val[]): Val => {
      switch (name) {
        case 'prop':
          return (lookup(str(a[0])) ?? null) as Val;
        case 'if':
          return truthy(a[0]) ? a[1] ?? null : a[2] ?? null;
        case 'concat':
          return a.map(str).join('');
        case 'length':
          return Array.isArray(a[0]) ? a[0].length : str(a[0]).length;
        case 'round': {
          const f = 10 ** num(a[1] ?? 0);
          return Math.round(num(a[0]) * f) / f;
        }
        case 'floor':
          return Math.floor(num(a[0]));
        case 'ceil':
          return Math.ceil(num(a[0]));
        case 'abs':
          return Math.abs(num(a[0]));
        case 'min':
          return Math.min(...a.map(num));
        case 'max':
          return Math.max(...a.map(num));
        case 'upper':
          return str(a[0]).toUpperCase();
        case 'lower':
          return str(a[0]).toLowerCase();
        case 'contains':
          return str(a[0]).toLowerCase().includes(str(a[1]).toLowerCase());
        case 'now':
          return new Date().toISOString().slice(0, 10);
        case 'datebetween': {
          const d1 = Date.parse(str(a[0]));
          const d2 = Date.parse(str(a[1]));
          if (Number.isNaN(d1) || Number.isNaN(d2)) return null;
          return Math.round((d1 - d2) / 86_400_000);
        }
        default:
          throw new Error(`Unknown function ${name}()`);
      }
    };
    const mul = binary(primary, ['*', '/', '%'], (op, x, y) => {
      const b = num(y);
      if (op !== '*' && b === 0) throw new Error('Division by zero');
      return op === '*' ? num(x) * b : op === '/' ? num(x) / b : num(x) % b;
    });
    const add = binary(mul, ['+', '-'], (op, x, y) =>
      op === '+' ? (typeof x === 'string' || typeof y === 'string' ? str(x) + str(y) : num(x) + num(y)) : num(x) - num(y),
    );
    const cmp = binary(add, ['>', '<', '>=', '<=', '==', '!='], (op, x, y) => {
      if (op === '==') return str(x) === str(y);
      if (op === '!=') return str(x) !== str(y);
      const bothNum = typeof x === 'number' || typeof y === 'number';
      const [l, r] = bothNum ? [num(x), num(y)] : [str(x), str(y)];
      return op === '>' ? l > r : op === '<' ? l < r : op === '>=' ? l >= r : l <= r;
    });
    const and = binary(cmp, ['&&'], (_op, x, y) => truthy(x) && truthy(y));
    const or = binary(and, ['||'], (_op, x, y) => truthy(x) || truthy(y));
    const value = or();
    if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Result is not a finite number');
    return { ok: true, value: value as CellValue };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
