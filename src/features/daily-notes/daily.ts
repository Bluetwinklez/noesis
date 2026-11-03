import type { Repos } from '../../core/store';
import type { DocNode } from '../../core/doc';
import type { Lang } from '../../i18n';
import type { Page } from '../../core/types';

export type DailyTitleFormat = 'iso' | 'short' | 'long';

const titleFormatters = Object.fromEntries((['en', 'tr'] as const).map((lang) => [lang, {
  short: new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
  long: new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
}])) as Record<Lang, Record<'short' | 'long', Intl.DateTimeFormat>>;

export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDailyTitle(date: Date, format: DailyTitleFormat, lang: Lang): string {
  if (format === 'iso') return localDayKey(date);
  return titleFormatters[lang][format].format(date);
}

export function dailyTitles(date: Date): string[] {
  return (['en', 'tr'] as const).flatMap((lang) => (['iso', 'short', 'long'] as const).map((format) => formatDailyTitle(date, format, lang)));
}

const pending = new WeakMap<Repos, Map<string, Promise<Page>>>();

export function monthGrid(year: number, month: number, weekStart: 0 | 1): Array<Date | null> {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return [...Array<Date | null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))];
}

export async function ensureDailyNote(
  repos: Repos,
  workspaceId: string,
  date: Date,
  options: { format: DailyTitleFormat; lang: Lang; templateId?: string | null },
): Promise<Page> {
  let queue = pending.get(repos);
  if (!queue) { queue = new Map(); pending.set(repos, queue); }
  // Serialize creation per workspace, including creation of the parent itself.
  const previous = queue.get(workspaceId);
  const work = (async () => {
    if (previous) await previous.catch(() => undefined);
    return createDailyNote(repos, workspaceId, date, options);
  })();
  queue.set(workspaceId, work);
  try { return await work; } finally { if (queue.get(workspaceId) === work) queue.delete(workspaceId); }
}

async function createDailyNote(repos: Repos, workspaceId: string, date: Date, options: { format: DailyTitleFormat; lang: Lang; templateId?: string | null }): Promise<Page> {
  const day = localDayKey(date);
  return repos.db.transaction(async (tx) => {
  const mapped = await tx.get<{ page_id: string }>('SELECT page_id FROM daily_notes WHERE workspace_id = ? AND day = ?', [workspaceId, day]);
  if (mapped) {
    const page = await tx.get<Page>('SELECT * FROM pages WHERE id = ?', [mapped.page_id]);
    if (page && !page.deleted_at && !page.archived_at) return page;
    if (page) throw new Error('The daily note is archived or in the trash; restore it before opening this day.');
  }
  const pages = await tx.all<Page>('SELECT * FROM pages WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY sort_order, created_at', [workspaceId]);
  let parent = pages.find((page) => page.parent_id === null && page.kind === 'page' && (page.title === 'Daily notes' || page.title === 'Günlük notlar'));
  if (!parent) {
    parent = await repos.pages.createIn(tx, { workspaceId, title: options.lang === 'tr' ? 'Günlük notlar' : 'Daily notes', icon: '📅' });
  }
  const title = formatDailyTitle(date, options.format, options.lang);
  const existing = pages.find((page) => page.parent_id === parent!.id && dailyTitles(date).includes(page.title));
  if (existing) {
    await tx.run('INSERT OR IGNORE INTO daily_notes(workspace_id, day, page_id) VALUES (?,?,?)', [workspaceId, day, existing.id]);
    return existing;
  }
  let content: DocNode | null = null;
  if (options.templateId) {
    const template = await tx.get<Page>('SELECT * FROM pages WHERE id = ?', [options.templateId]);
    if (template?.workspace_id === workspaceId && template.is_template && template.content_json) content = JSON.parse(template.content_json) as DocNode;
  }
    const page = await repos.pages.createIn(tx, { workspaceId, parentId: parent.id, title, icon: '🗓️', content });
    await tx.run('INSERT INTO daily_notes(workspace_id, day, page_id) VALUES (?,?,?)', [workspaceId, day, page.id]);
    return page;
  });
}
