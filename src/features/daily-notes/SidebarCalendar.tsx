import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { repos, useApp } from '../../app/state';
import { useT } from '../../i18n';
import { cx, IconButton, useAsync } from '../../components/ui';
import { openDailyNote } from '../actions';
import { dailyTitles, localDayKey, monthGrid } from './daily';
import type { PageMeta } from '../../core/types';

export function SidebarCalendar({ pages }: { pages: PageMeta[] }) {
  const t = useT();
  const lang = useApp((state) => state.lang);
  const prefs = useApp((state) => state.prefs);
  const workspaceId = useApp((state) => state.workspaceId);
  const version = useApp((state) => state.version);
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const { data } = useAsync(async () => workspaceId ? Promise.all([repos().tasks.list(workspaceId), repos().db.all<{ day: string }>('SELECT d.day FROM daily_notes d JOIN pages p ON p.id = d.page_id WHERE d.workspace_id = ? AND p.deleted_at IS NULL AND p.archived_at IS NULL', [workspaceId])]) : [[], []] as const, [workspaceId, version]);
  const days = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth(), prefs.weekStart), [cursor, prefs.weekStart]);
  const pageTitles = useMemo(() => {
    const parent = pages.find((page) => page.parent_id === null && (page.title === 'Daily notes' || page.title === 'Günlük notlar'));
    return new Set(pages.filter((page) => page.parent_id === parent?.id).map((page) => page.title));
  }, [pages]);
  const taskDays = useMemo(() => new Set((data?.[0] ?? []).filter((task) => task.due_at && task.status !== 'done' && task.status !== 'cancelled').map((task) => localDayKey(new Date(task.due_at!)))), [data]);
  const noteDays = useMemo(() => new Set((data?.[1] ?? []).map((note) => note.day)), [data]);
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const weekBase = new Date(2026, 10, prefs.weekStart === 1 ? 2 : 1);
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(weekBase.getFullYear(), weekBase.getMonth(), weekBase.getDate() + index)));
  const today = localDayKey(new Date());
  return (
    <section className="mx-1 mt-3 rounded-lg border border-line bg-elevated/40 p-2" aria-label={t('daily.calendar')}>
      <div className="mb-1 flex items-center justify-between">
        <IconButton size="sm" label={t('daily.previousMonth')} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft className="size-3.5" /></IconButton>
        <button className="text-xs font-semibold" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>{new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(cursor)}</button>
        <IconButton size="sm" label={t('daily.nextMonth')} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight className="size-3.5" /></IconButton>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-faint">{weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((date, index) => date ? (() => {
          const key = localDayKey(date);
          // Keep markers visible after the user changes the preferred title style.
          const hasNote = noteDays.has(key) || (pageTitles.size > 0 && dailyTitles(date).some((title) => pageTitles.has(title)));
          const hasTask = taskDays.has(key);
          return <button key={key} aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(date)} onClick={() => void openDailyNote(date)} className={cx('relative flex h-7 items-center justify-center rounded text-[11px] hover:bg-hover', key === today && 'bg-accent-soft font-semibold text-accent')}>
            {date.getDate()}
            {(hasNote || hasTask) && <span className="absolute bottom-0.5 flex gap-0.5">{hasNote && <i className="size-1 rounded-full bg-accent" />}{hasTask && <i className="size-1 rounded-full bg-warning" />}</span>}
          </button>;
        })() : <span key={`blank-${index}`} />)}
      </div>
    </section>
  );
}
