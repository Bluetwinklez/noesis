import { useState } from 'react';
import { ArrowRight, BookOpen, Check, Moon, Sparkles, Sun, Monitor } from 'lucide-react';
import { repos, useApp } from '../../app/state';
import { LANGUAGES, useT } from '../../i18n';
import { Button, Input, cx, Kbd } from '../../components/ui';
import { ingestion, reportError, saveLang, savePrefs, setWorkspace } from '../../app/services';
import { AiSettings } from '../settings/SettingsPage';
import { seedSampleContent } from './sample';
import { PalettePicker } from '../../components/PalettePicker';

const STEPS = ['welcome', 'workspace', 'appearance', 'ai', 'sample', 'editor', 'notebook'] as const;
type Step = (typeof STEPS)[number];

/** First-run flow. Every step after the workspace name can be skipped. */
export function Onboarding() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const prefs = useApp((s) => s.prefs);
  const [step, setStep] = useState<Step>('welcome');
  const [wsName, setWsName] = useState('');
  const [nbTitle, setNbTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)]);

  const createWorkspace = async () => {
    setBusy(true);
    try {
      const existing = await repos().workspaces.list();
      const ws = existing.length && useApp.getState().workspaceId ? existing.find((w) => w.id === useApp.getState().workspaceId)! : await repos().workspaces.create(wsName.trim() || (lang === 'tr' ? 'Çalışma alanım' : 'My workspace'));
      await setWorkspace(ws.id);
      next();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (openNotebook?: string | null) => {
    await savePrefs({ onboarded: true });
    if (openNotebook) useApp.getState().navigate({ name: 'notebook', id: openNotebook });
  };

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-accent-soft via-bg to-bg p-6">
      <div className="w-full max-w-[560px] rounded-2xl border border-line bg-elevated p-8 shadow-pop animate-in">
        <div className="mb-6 flex gap-1" aria-hidden>
          {STEPS.map((s, i) => (
            <div key={s} className={cx('h-1 flex-1 rounded-full', i <= idx ? 'bg-accent' : 'bg-active')} />
          ))}
        </div>

        {step === 'welcome' && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-strong text-3xl font-bold text-white shadow-soft">N</div>
            <h1 className="font-display text-3xl font-bold">{t('onb.welcome')}</h1>
            <p className="mx-auto mt-2 max-w-sm text-muted">{t('onb.welcomeBody')}</p>
            <div className="mt-6 flex justify-center gap-2">
              {LANGUAGES.map((l) => (
                <Button key={l.id} size="sm" variant={lang === l.id ? 'primary' : 'secondary'} onClick={() => void saveLang(l.id)}>
                  {l.label}
                </Button>
              ))}
            </div>
            <Button variant="primary" className="mt-8 w-full" onClick={next}>
              {t('onb.start')} <ArrowRight className="size-4" />
            </Button>
          </div>
        )}

        {step === 'workspace' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createWorkspace();
            }}
          >
            <h2 className="mb-4 font-display text-2xl font-bold">{t('onb.workspace')}</h2>
            <Input autoFocus value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder={t('onb.workspacePlaceholder')} aria-label={t('onb.workspace')} />
            <Button variant="primary" type="submit" className="mt-6 w-full" loading={busy}>
              {t('common.next')} <ArrowRight className="size-4" />
            </Button>
          </form>
        )}

        {step === 'appearance' && (
          <div>
            <h2 className="mb-4 font-display text-2xl font-bold">{t('onb.appearance')}</h2>
            <div className="grid grid-cols-3 gap-3">
              {([
                ['light', <Sun key="l" className="size-5" />],
                ['dark', <Moon key="d" className="size-5" />],
                ['system', <Monitor key="s" className="size-5" />],
              ] as const).map(([th, icon]) => (
                <button
                  key={th}
                  onClick={() => void savePrefs({ theme: th })}
                  className={cx('flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-sm', prefs.theme === th ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong')}
                >
                  {icon}
                  {t(`settings.theme.${th}`)}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <PalettePicker compact />
            </div>
            <div className="mt-4 flex justify-center gap-2">
              {[252, 220, 160, 30, 0, 330].map((h) => (
                <button key={h} aria-label={`Accent ${h}`} onClick={() => void savePrefs({ accentHue: h })} className={cx('size-7 rounded-full', prefs.accentHue === h && 'ring-2 ring-fg ring-offset-2 ring-offset-elevated')} style={{ background: `hsl(${h} 75% 58%)` }} />
              ))}
            </div>
            <Button variant="primary" className="mt-8 w-full" onClick={next}>
              {t('common.next')} <ArrowRight className="size-4" />
            </Button>
          </div>
        )}

        {step === 'ai' && (
          <div>
            <h2 className="mb-1 font-display text-2xl font-bold">{t('onb.ai')}</h2>
            <p className="mb-4 text-sm text-muted">{t('onb.aiBody')}</p>
            <AiSettings compact />
            <div className="mt-6 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={next}>
                {t('common.skip')}
              </Button>
              <Button variant="primary" className="flex-1" onClick={next}>
                {t('common.next')}
              </Button>
            </div>
          </div>
        )}

        {step === 'sample' && (
          <div>
            <h2 className="mb-1 font-display text-2xl font-bold">{t('onb.sample')}</h2>
            <p className="mb-6 text-sm text-muted">{t('onb.sampleBody')}</p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={next}>
                {t('onb.sampleNo')}
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                loading={busy}
                icon={<Sparkles className="size-4" />}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await seedSampleContent(repos(), useApp.getState().workspaceId!, lang, ingestion());
                    setNotebookId(r.notebook.id);
                    useApp.getState().bump();
                    next();
                  } catch (e) {
                    reportError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('onb.sampleYes')}
              </Button>
            </div>
          </div>
        )}

        {step === 'editor' && (
          <div>
            <h2 className="mb-4 font-display text-2xl font-bold">{t('onb.editorIntro')}</h2>
            <ul className="space-y-3 text-sm">
              {[
                [<Kbd key="a">/</Kbd>, t('shortcut.slash')],
                [<Kbd key="b">@</Kbd>, t('editor.slash.mention')],
                [<Kbd key="c">Ctrl K</Kbd>, t('shortcut.palette')],
                [<span key="d" className="text-accent">⋮⋮</span>, t('editor.block.turnInto') + ' / drag'],
                [<Sparkles key="e" className="size-4 text-accent" />, t('ai.actions') + ' — ' + t('ai.previewHint')],
              ].map(([k, label], i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex w-16 shrink-0 justify-center">{k}</span>
                  <span className="min-w-0">{label}</span>
                </li>
              ))}
            </ul>
            <Button variant="primary" className="mt-8 w-full" onClick={next}>
              {t('common.next')} <ArrowRight className="size-4" />
            </Button>
          </div>
        )}

        {step === 'notebook' && (
          <div>
            <h2 className="mb-4 flex items-center gap-2 font-display text-2xl font-bold">
              <BookOpen className="size-6 text-accent" /> {t('onb.notebook')}
            </h2>
            {notebookId ? (
              <p className="mb-4 flex items-center gap-2 text-sm text-success">
                <Check className="size-4" /> {t('onb.notebookReady')}
              </p>
            ) : (
              <Input value={nbTitle} onChange={(e) => setNbTitle(e.target.value)} placeholder={t('onb.notebookPlaceholder')} aria-label={t('onb.notebookPlaceholder')} />
            )}
            <div className="mt-6 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => void finish(notebookId)}>
                {t('common.skip')}
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={async () => {
                  let id = notebookId;
                  if (!id && nbTitle.trim()) id = (await repos().notebooks.create(useApp.getState().workspaceId!, nbTitle.trim())).id;
                  await finish(id);
                }}
              >
                {t('onb.finish')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
