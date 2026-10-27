import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { PALETTES } from '../app/palettes';
import { savePrefs } from '../app/services';
import { useApp } from '../app/state';
import { useT, type MessageKey } from '../i18n';
import { cx } from './ui';

/** Follows the `dark` class on <html>, which is set after the preference changes. */
function useDarkClass() {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const [dark, setDark] = useState(() => !!root?.classList.contains('dark'));
  useEffect(() => {
    if (!root) return;
    const obs = new MutationObserver(() => setDark(root.classList.contains('dark')));
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [root]);
  return dark;
}

/** Grid of palette cards; each card is a miniature of the app in that palette (light/dark follows the current theme). */
export function PalettePicker({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  const dark = useDarkClass();
  return (
    <div role="radiogroup" aria-label={t('settings.palette')} className={cx('grid gap-2', compact ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4')}>
      {PALETTES.map((p) => {
        const s = dark ? p.dark : p.light;
        const active = (prefs.palette ?? 'paper') === p.id;
        const accent = `hsl(${p.accentHue} 75% ${dark ? 68 : 58}%)`;
        return (
          <button
            key={p.id}
            role="radio"
            aria-checked={active}
            onClick={() => void savePrefs({ palette: p.id, accentHue: p.accentHue })}
            className={cx('overflow-hidden rounded-lg border text-left transition', active ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-line-strong')}
          >
            <div className="flex h-14" style={{ background: s.bg }}>
              <div className="w-1/3 space-y-1 p-1.5" style={{ background: s.sidebar }}>
                <div className="h-1.5 w-3/4 rounded-full" style={{ background: s.faint }} />
                <div className="h-1.5 w-1/2 rounded-full" style={{ background: accent }} />
                <div className="h-1.5 w-2/3 rounded-full" style={{ background: s.faint }} />
              </div>
              <div className="flex-1 space-y-1 p-2">
                <div className="h-2 w-2/3 rounded-full" style={{ background: s.text }} />
                <div className="h-1.5 w-full rounded-full" style={{ background: s.muted }} />
                <div className="h-1.5 w-4/5 rounded-full" style={{ background: s.muted }} />
              </div>
            </div>
            <div className="flex items-center justify-between bg-elevated px-2 py-1 text-xs">
              <span>{t(`palette.${p.id}` as MessageKey)}</span>
              {active && <Check className="size-3 text-accent" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
