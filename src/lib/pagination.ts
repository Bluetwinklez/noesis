export interface PageWindow<T> {
  items: T[];
  page: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
}

export function pageWindow<T>(items: T[], requestedPage: number, pageSize: number): PageWindow<T> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Page size must be a positive integer.');
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(0, Math.trunc(requestedPage)), pageCount - 1);
  const startIndex = page * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  return {
    items: pageItems,
    page,
    pageCount,
    start: items.length ? startIndex + 1 : 0,
    end: startIndex + pageItems.length,
    total: items.length,
  };
}
