/** Validated, workspace-scoped page tabs. A page may appear only once. */
export interface PageTabs { ids: string[]; active: string | null; split: string | null }
export const EMPTY_TABS: PageTabs = { ids: [], active: null, split: null };

export function normalizeTabs(value: Partial<PageTabs>, validIds: Set<string>): PageTabs {
  const ids = [...new Set(Array.isArray(value.ids) ? value.ids.filter((id): id is string => typeof id === 'string' && validIds.has(id)) : [])].slice(0, 30);
  const active = typeof value.active === 'string' && ids.includes(value.active) ? value.active : ids[0] ?? null;
  const split = typeof value.split === 'string' && ids.includes(value.split) && value.split !== active ? value.split : null;
  return { ids, active, split };
}

export function openTab(tabs: PageTabs, id: string): PageTabs {
  const ids = tabs.ids.includes(id) ? tabs.ids : [...tabs.ids, id].slice(-30);
  return { ids, active: id, split: tabs.split === id ? null : tabs.split };
}

export function closeTab(tabs: PageTabs, id: string): PageTabs {
  const ids = tabs.ids.filter((item) => item !== id);
  const active = tabs.active === id ? ids[Math.min(tabs.ids.indexOf(id), ids.length - 1)] ?? null : tabs.active;
  return { ids, active, split: tabs.split === id || tabs.split === active ? null : tabs.split };
}
