import { describe, expect, it } from 'vitest';
import { pageWindow } from '../../src/lib/pagination';

describe('pageWindow', () => {
  it('limits a large table to one render window without losing totals', () => {
    const rows = Array.from({ length: 2_000 }, (_, i) => i);
    const first = pageWindow(rows, 0, 100);
    expect(first).toMatchObject({ page: 0, pageCount: 20, start: 1, end: 100, total: 2_000 });
    expect(first.items).toHaveLength(100);
    expect(pageWindow(rows, 19, 100).items).toEqual(rows.slice(1_900));
  });

  it('clamps pages after filters shrink the result set', () => {
    expect(pageWindow([1, 2, 3], 99, 2)).toMatchObject({ page: 1, pageCount: 2, start: 3, end: 3 });
    expect(pageWindow([], -4, 100)).toMatchObject({ page: 0, pageCount: 1, start: 0, end: 0, total: 0 });
  });
});
