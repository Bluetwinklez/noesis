import { useEffect, useState } from 'react';
import {
  Bell,
  Bot,
  Database as DbIcon,
  Download,
  FolderOpen,
  Globe,
  HardDrive,
  Keyboard,
  Palette,
  RefreshCw,
  Plug,
  Shield,
  Stethoscope,
  Upload,
  Layers,
  Trash2,
  Plus,
  Check,
  SlidersHorizontal,
  Type as TypeIcon,
} from 'lucide-react';
import { DEFAULT_PREFS, repos, useApp, type Prefs } from '../../app/state';
import { runAutoBackup } from '../../app/maintenance';
import { LANGUAGES, useT, type MessageKey } from '../../i18n';
import { Badge, Button, confirmDialog, cx, Input, Kbd, promptDialog, Select, Switch, useAsync } from '../../components/ui';
import { activeProvider, apiKeyName, configForProvider, errorMessage, reportError, saveAiConfig, saveLang, savePrefs, setWorkspace } from '../../app/services';
import { McpSettings } from '../mcp/McpSettings';
import { runExportAll, runImport } from '../import/runImport';
import { PalettePicker } from '../../components/PalettePicker';
import { checkForUpdates, installUpdate, setUpdatePrefs, useUpdates } from '../../app/updater';
import { appInfo, isTauri, notify, pickFiles, revealDataDir, saveFile, secrets, blobStore } from '../../lib/platform';
import { createBackup, rebuildSearchIndex, restoreBackup } from '../../core/backup';
import { integrityCheck, LATEST_VERSION } from '../../core/db/migrations';
import type { ProviderId } from '../../ai/types';
import { formatBytes, relativeTime } from '../../lib/util';

const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.1.0';

const SECTIONS: { id: string; label: MessageKey; icon: React.ReactNode }[] = [
  { id: 'general', label: 'settings.general', icon: <SlidersHorizontal className="size-4" /> },
  { id: 'appearance', label: 'settings.appearance', icon: <Palette className="size-4" /> },
  { id: 'editor', label: 'settings.editor', icon: <TypeIcon className="size-4" /> },
  { id: 'language', label: 'settings.language', icon: <Globe className="size-4" /> },
  { id: 'ai', label: 'settings.ai', icon: <Bot className="size-4" /> },
  { id: 'mcp', label: 'mcp.title', icon: <Plug className="size-4" /> },
  { id: 'workspaces', label: 'settings.workspaces', icon: <Layers className="size-4" /> },
  { id: 'storage', label: 'settings.storage', icon: <HardDrive className="size-4" /> },
  { id: 'shortcuts', label: 'settings.shortcuts', icon: <Keyboard className="size-4" /> },
  { id: 'privacy', label: 'settings.privacy', icon: <Shield className="size-4" /> },
  { id: 'notifications', label: 'settings.notifications', icon: <Bell className="size-4" /> },
  { id: 'updates', label: 'settings.updates', icon: <RefreshCw className="size-4" /> },
  { id: 'diagnostics', label: 'settings.diagnostics', icon: <Stethoscope className="size-4" /> },
];

export default function SettingsPage({ section }: { section?: string }) {
  const t = useT();
  const [cur, setCur] = useState(section ?? 'general');
  useEffect(() => {
    if (section) setCur(section);
  }, [section]);
  return (
    <div className="mx-auto flex max-w-[1040px] gap-8 px-8 py-10">
      <nav className="w-52 shrink-0 space-y-0.5" aria-label={t('settings.title')}>
        <h1 className="mb-4 font-display text-2xl font-bold">{t('settings.title')}</h1>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setCur(s.id)}
            aria-current={cur === s.id ? 'page' : undefined}
            className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm', cur === s.id ? 'bg-active font-medium' : 'text-muted hover:bg-hover')}
          >
            {s.icon}
            {t(s.label)}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 pt-12">
        {cur === 'general' && <General />}
        {cur === 'appearance' && <Appearance />}
        {cur === 'editor' && <EditorSettings />}
        {cur === 'language' && <Language />}
        {cur === 'ai' && <AiSettings />}
        {cur === 'mcp' && <McpSettings />}
        {cur === 'workspaces' && <Workspaces />}
        {cur === 'storage' && <Storage />}
        {cur === 'shortcuts' && <Shortcuts />}
        {cur === 'privacy' && <Privacy />}
        {cur === 'notifications' && <Notifications />}
        {cur === 'updates' && <Updates />}
        {cur === 'diagnostics' && <Diagnostics />}
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Segmented single choice (radio group of buttons). */
function Choice<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap justify-end gap-1">
      {options.map((o) => (
        <Button key={String(o.value)} size="sm" role="radio" aria-checked={o.value === value} variant={o.value === value ? 'primary' : 'secondary'} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function General() {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  return (
    <section>
      <Row label={t('settings.startPage')} hint={t('settings.startPageHint')}>
        <Choice
          label={t('settings.startPage')}
          value={prefs.startPage}
          onChange={(v) => void savePrefs({ startPage: v })}
          options={[
            { value: 'home', label: t('settings.startPage.home') },
            { value: 'last', label: t('settings.startPage.last') },
          ]}
        />
      </Row>
      <Row label={t('settings.weekStart')}>
        <Choice
          label={t('settings.weekStart')}
          value={prefs.weekStart}
          onChange={(v) => void savePrefs({ weekStart: v })}
          options={[
            { value: 1, label: t('settings.weekStart.monday') },
            { value: 0, label: t('settings.weekStart.sunday') },
          ]}
        />
      </Row>
      <Row label={t('settings.reset')} hint={t('settings.resetHint')}>
        <Button
          size="sm"
          onClick={async () => {
            if (!(await confirmDialog(t('settings.reset'), t('settings.resetConfirm')))) return;
            // Look and behaviour only: consents, AI connections and backup history stay as they are.
            const keep: (keyof Prefs)[] = ['onboarded', 'cloudConsents', 'lastBackupAt', 'lastAutoBackupAt', 'mcpEnabled', 'mcpAutoApprove'];
            const cur = useApp.getState().prefs;
            await savePrefs({ ...DEFAULT_PREFS, ...Object.fromEntries(keep.map((k) => [k, cur[k]])) });
            useApp.getState().toast(t('settings.resetDone'), 'success');
          }}
        >
          {t('settings.reset')}
        </Button>
      </Row>
    </section>
  );
}

function EditorSettings() {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  return (
    <section>
      <Row label={t('settings.editorFont')}>
        <Choice
          label={t('settings.editorFont')}
          value={prefs.editorFont}
          onChange={(v) => void savePrefs({ editorFont: v })}
          options={[
            { value: 'sans', label: <span style={{ fontFamily: 'var(--font-sans)' }}>{t('settings.editorFont.sans')}</span> },
            { value: 'serif', label: <span style={{ fontFamily: 'var(--font-serif)' }}>{t('settings.editorFont.serif')}</span> },
            { value: 'mono', label: <span style={{ fontFamily: 'var(--font-mono)' }}>{t('settings.editorFont.mono')}</span> },
          ]}
        />
      </Row>
      <Row label={t('settings.fontSize')}>
        <div className="flex items-center gap-2">
          <input type="range" min={13} max={22} value={prefs.editorFontSize} onChange={(e) => void savePrefs({ editorFontSize: Number(e.target.value) })} aria-label={t('settings.fontSize')} />
          <span className="w-8 text-sm text-muted">{prefs.editorFontSize}</span>
        </div>
      </Row>
      <Row label={t('settings.lineHeight')}>
        <Choice
          label={t('settings.lineHeight')}
          value={prefs.lineHeight}
          onChange={(v) => void savePrefs({ lineHeight: v })}
          options={[
            { value: 'compact', label: t('settings.lineHeight.compact') },
            { value: 'normal', label: t('settings.lineHeight.normal') },
            { value: 'relaxed', label: t('settings.lineHeight.relaxed') },
          ]}
        />
      </Row>
      <Row label={t('settings.fullWidth')}>
        <Switch checked={prefs.fullWidth} onChange={(v) => void savePrefs({ fullWidth: v })} label={t('settings.fullWidth')} />
      </Row>
      <Row label={t('settings.spellcheck')} hint={t('settings.spellcheckHint')}>
        <Switch checked={prefs.spellcheck} onChange={(v) => void savePrefs({ spellcheck: v })} label={t('settings.spellcheck')} />
      </Row>
      <Row label={t('settings.wordCount')}>
        <Switch checked={prefs.showWordCount} onChange={(v) => void savePrefs({ showWordCount: v })} label={t('settings.wordCount')} />
      </Row>
      <div className="mt-6 rounded-lg border border-line p-4" style={{ fontFamily: 'var(--editor-font)', fontSize: 'var(--editor-font-size)', lineHeight: 'var(--editor-line-height)' }}>
        <div className="mb-1 text-xs uppercase tracking-wide text-faint" style={{ fontFamily: 'var(--font-sans)' }}>
          {t('settings.preview')}
        </div>
        {t('settings.previewText')}
      </div>
    </section>
  );
}

const ACCENTS = [252, 220, 190, 160, 140, 30, 0, 330, 280];

export function Appearance() {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  return (
    <section>
      <Row label={t('settings.theme')}>
        <div className="flex gap-1">
          {(['light', 'dark', 'system'] as const).map((th) => (
            <Button key={th} size="sm" variant={prefs.theme === th ? 'primary' : 'secondary'} onClick={() => void savePrefs({ theme: th })}>
              {t(`settings.theme.${th}`)}
            </Button>
          ))}
        </div>
      </Row>
      <div className="border-b border-line py-4">
        <div className="mb-1 font-medium">{t('settings.palette')}</div>
        <p className="mb-3 text-xs text-muted">{t('settings.paletteHint')}</p>
        <PalettePicker />
      </div>
      <Row label={t('settings.accent')}>
        <div className="flex gap-1.5">
          {ACCENTS.map((h) => (
            <button
              key={h}
              aria-label={`Accent hue ${h}`}
              onClick={() => void savePrefs({ accentHue: h })}
              className={cx('flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-bg', prefs.accentHue === h && 'ring-2 ring-fg')}
              style={{ background: `hsl(${h} 75% 58%)` }}
            >
              {prefs.accentHue === h && <Check className="size-3 text-white" />}
            </button>
          ))}
        </div>
      </Row>
      <Row label={t('settings.uiScale')} hint={t('settings.uiScaleHint')}>
        <Choice
          label={t('settings.uiScale')}
          value={prefs.uiScale}
          onChange={(v) => void savePrefs({ uiScale: v })}
          options={[90, 100, 110, 125].map((v) => ({ value: v, label: `${v}%` }))}
        />
      </Row>
      <Row label={t('settings.motion')} hint={t('settings.motionHint')}>
        <Choice
          label={t('settings.motion')}
          value={prefs.motion}
          onChange={(v) => void savePrefs({ motion: v })}
          options={[
            { value: 'system', label: t('settings.motion.system') },
            { value: 'reduce', label: t('settings.motion.reduce') },
            { value: 'full', label: t('settings.motion.full') },
          ]}
        />
      </Row>
    </section>
  );
}

function Language() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  return (
    <section>
      <Row label={t('settings.language')}>
        <Select value={lang} onChange={(v) => void saveLang(v)} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} ariaLabel={t('settings.language')} />
      </Row>
    </section>
  );
}

export function AiSettings({ compact }: { compact?: boolean }) {
  const t = useT();
  const ai = useApp((s) => s.ai);
  const hasKey = useApp((s) => s.hasApiKey);
  const prefs = useApp((s) => s.prefs);
  const [draft, setDraft] = useState(ai);
  const [key, setKey] = useState('');
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    setDraft(ai);
  }, [ai]);
  const needsKey = draft.provider === 'openai' || draft.provider === 'gemini' || draft.provider === 'anthropic' || draft.provider === 'custom';
  const save = async () => {
    if (key.trim() && draft.provider !== 'none') await secrets.set(apiKeyName(draft.provider), key.trim());
    setKey('');
    await saveAiConfig(draft);
    useApp.getState().toast(t('common.save') + ' ✓', 'success');
  };
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      await save();
      const p = await activeProvider();
      if (!p) throw new Error(t('ai.notConfigured'));
      // A minimal prompt with no user content.
      const reply = await p.chat({ messages: [{ role: 'user', content: 'Reply with the single word: OK' }], maxTokens: 16 });
      setTest({ ok: true, msg: t('settings.testOk', { reply: reply.trim().slice(0, 40) }) });
    } catch (e) {
      setTest({ ok: false, msg: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };
  const field = (label: MessageKey, k: 'baseUrl' | 'chatModel' | 'embeddingModel' | 'ttsModel' | 'transcriptionModel') => (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{t(label)}</span>
      <Input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
    </label>
  );
  return (
    <section className="space-y-4">
      <label className="block space-y-1">
        <span className="text-xs text-muted">{t('settings.provider')}</span>
        <Select<ProviderId>
          className="w-full"
          ariaLabel={t('settings.provider')}
          value={draft.provider}
          onChange={(v) => setDraft(configForProvider(v, draft))}
          options={[
            { value: 'none', label: t('settings.none') },
            { value: 'openai', label: 'OpenAI' },
            { value: 'gemini', label: 'Google Gemini' },
            { value: 'anthropic', label: 'Anthropic Claude' },
            { value: 'ollama', label: 'Ollama (local)' },
            { value: 'custom', label: 'OpenAI-compatible (LM Studio, vLLM, …)' },
          ]}
        />
      </label>
      {draft.provider !== 'none' && (
        <>
          {needsKey && (
            <label className="block space-y-1">
              <span className="text-xs text-muted">{t('settings.apiKey')}</span>
              <div className="flex gap-2">
                <Input type="password" autoComplete="off" value={key} placeholder={hasKey && ai.provider === draft.provider ? '••••••••••••' : 'sk-…'} onChange={(e) => setKey(e.target.value)} />
                {hasKey && ai.provider === draft.provider && (
                  <Button
                    onClick={async () => {
                      await secrets.remove(apiKeyName(draft.provider));
                      await saveAiConfig(draft);
                    }}
                  >
                    {t('settings.removeKey')}
                  </Button>
                )}
              </div>
              <span className={cx('block text-xs', secrets.secure ? 'text-muted' : 'text-warning')}>{secrets.secure ? t('settings.apiKeySaved') : t('settings.apiKeyPreview')}</span>
            </label>
          )}
          {!compact && (
            <div className="grid grid-cols-2 gap-3">
              {field('settings.baseUrl', 'baseUrl')}
              {field('settings.chatModel', 'chatModel')}
              {field('settings.embeddingModel', 'embeddingModel')}
              {field('settings.ttsModel', 'ttsModel')}
              {field('settings.transcriptionModel', 'transcriptionModel')}
              <label className="block space-y-1">
                <span className="text-xs text-muted">{t('settings.voices')}</span>
                <div className="flex gap-2">
                  <Input value={draft.ttsVoices[0]} onChange={(e) => setDraft({ ...draft, ttsVoices: [e.target.value, draft.ttsVoices[1]] })} />
                  <Input value={draft.ttsVoices[1]} onChange={(e) => setDraft({ ...draft, ttsVoices: [draft.ttsVoices[0], e.target.value] })} />
                </div>
              </label>
              <label className="col-span-2 block space-y-1">
                <span className="text-xs text-muted">
                  {t('settings.temperature')}: {draft.temperature}
                </span>
                <input type="range" min={0} max={1} step={0.1} value={draft.temperature} onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })} className="w-full" />
              </label>
            </div>
          )}
          {!compact && <Capabilities />}
          {draft.provider !== 'ollama' && !compact && (
            <Row label={t('settings.cloudConsent')} hint={t('ai.consent.body', { provider: draft.provider })}>
              <Switch
                checked={prefs.cloudConsents.includes(draft.provider)}
                onChange={(v) =>
                  void savePrefs({ cloudConsents: v ? [...new Set([...prefs.cloudConsents, draft.provider])] : prefs.cloudConsents.filter((x) => x !== draft.provider) })
                }
              />
            </Row>
          )}
        </>
      )}
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={() => void save().catch(reportError)}>
          {t('common.save')}
        </Button>
        {draft.provider !== 'none' && (
          <Button loading={testing} onClick={() => void runTest()}>
            {t('settings.test')}
          </Button>
        )}
      </div>
      {test && (
        <div role="status" className={cx('rounded-lg p-3 text-sm', test.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>
          {test.msg}
        </div>
      )}
    </section>
  );
}

function Capabilities() {
  const t = useT();
  const ai = useApp((s) => s.ai);
  const hasKey = useApp((s) => s.hasApiKey);
  const { data: p } = useAsync(() => activeProvider(), [ai, hasKey]);
  if (!p) return null;
  const c = p.capabilities;
  const item = (ok: boolean, label: string) => <Badge color={ok ? 'green' : 'gray'}>{ok ? '✓' : '—'} {label}</Badge>;
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{t('settings.capabilities')}</div>
      <div className="flex flex-wrap gap-1.5">
        {item(c.chat, 'Chat')}
        {item(c.embeddings, 'Embeddings')}
        {item(c.tts, 'Text-to-speech')}
        {item(c.multiSpeakerTts, 'Multi-voice')}
        {item(c.transcription, 'Transcription')}
        {item(c.vision, 'Vision / OCR')}
        {item(!p.isCloud, 'Local (no upload)')}
      </div>
    </div>
  );
}

function Workspaces() {
  const t = useT();
  const version = useApp((s) => s.version);
  const current = useApp((s) => s.workspaceId);
  const bump = useApp((s) => s.bump);
  const { data } = useAsync(() => repos().workspaces.list(), [version]);
  return (
    <section>
      {data?.map((w) => (
        <Row key={w.id} label={`${w.icon ?? '◆'} ${w.name}`} hint={w.id === current ? '✓' : undefined}>
          <div className="flex gap-1">
            {w.id !== current && (
              <Button size="sm" onClick={() => void setWorkspace(w.id)}>
                {t('common.open')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={async () => {
                const name = await promptDialog(t('common.rename'), w.name);
                if (name?.trim()) {
                  await repos().workspaces.rename(w.id, name);
                  bump();
                }
              }}
            >
              {t('common.rename')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={(data?.length ?? 0) <= 1}
              icon={<Trash2 className="size-3.5" />}
              onClick={async () => {
                if (!(await confirmDialog(t('settings.deleteWorkspace'), t('settings.deleteWorkspaceConfirm', { name: w.name }), { danger: true }))) return;
                await repos().workspaces.remove(w.id);
                const rest = (await repos().workspaces.list())[0];
                if (rest) await setWorkspace(rest.id);
                bump();
              }}
            />
          </div>
        </Row>
      ))}
      <Button
        className="mt-4"
        icon={<Plus className="size-4" />}
        onClick={async () => {
          const name = await promptDialog(t('settings.newWorkspace'));
          if (!name?.trim()) return;
          const ws = await repos().workspaces.create(name);
          await setWorkspace(ws.id);
        }}
      >
        {t('settings.newWorkspace')}
      </Button>
    </section>
  );
}

export async function downloadBackup(): Promise<string | null> {
  const bytes = await createBackup(repos().db, blobStore, APP_VERSION);
  const path = await saveFile(`noesis-backup-${new Date().toISOString().slice(0, 10)}.noesisbak`, bytes, [{ name: 'Noesis backup', extensions: ['noesisbak'] }]);
  if (path) await savePrefs({ lastBackupAt: Date.now() });
  return path;
}

function Storage() {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  const storageKind = useApp((s) => s.storageKind);
  const { data: info } = useAsync(() => appInfo(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const wrap = (name: string, fn: () => Promise<void>) => async () => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section>
      <Row label={t('settings.dataLocation')} hint={info?.dbPath ?? (storageKind === 'wasm' ? 'Browser storage (IndexedDB) — preview mode' : '')}>
        {isTauri() && (
          <Button size="sm" icon={<FolderOpen className="size-3.5" />} onClick={() => void revealDataDir()}>
            {t('settings.openFolder')}
          </Button>
        )}
      </Row>
      {info && (
        <Row label={t('settings.storageMode')} hint={`SQLite ${formatBytes(info.dbBytes)} · attachments ${formatBytes(info.attachmentsBytes)}`}>
          <DbIcon className="size-4 text-muted" />
        </Row>
      )}
      <Row label={t('settings.backupNow')} hint={prefs.lastBackupAt ? new Date(prefs.lastBackupAt).toLocaleString() : undefined}>
        <Button
          size="sm"
          icon={<Download className="size-3.5" />}
          loading={busy === 'backup'}
          onClick={wrap('backup', async () => {
            if (await downloadBackup()) useApp.getState().toast(t('settings.backupDone'), 'success');
          })}
        >
          {t('settings.backupNow')}
        </Button>
      </Row>
      <Row label={t('settings.autoBackup')} hint={isTauri() ? t('settings.autoBackupHint', { when: prefs.lastAutoBackupAt ? new Date(prefs.lastAutoBackupAt).toLocaleString() : t('settings.never') }) : t('settings.desktopOnly')}>
        {isTauri() ? (
          <Choice
            label={t('settings.autoBackup')}
            value={prefs.autoBackup}
            onChange={(v) => void savePrefs({ autoBackup: v })}
            options={[
              { value: 'off', label: t('settings.autoBackup.off') },
              { value: 'daily', label: t('settings.autoBackup.daily') },
              { value: 'weekly', label: t('settings.autoBackup.weekly') },
            ]}
          />
        ) : (
          <span className="text-xs text-faint">—</span>
        )}
      </Row>
      {isTauri() && prefs.autoBackup !== 'off' && (
        <Row label={t('settings.autoBackupKeep')}>
          <div className="flex items-center gap-2">
            <Select
              ariaLabel={t('settings.autoBackupKeep')}
              value={String(prefs.autoBackupKeep)}
              onChange={(v) => void savePrefs({ autoBackupKeep: Number(v) })}
              options={[3, 7, 14, 30].map((n) => ({ value: String(n), label: t('settings.autoBackupKeepN', { n }) }))}
            />
            <Button
              size="sm"
              loading={busy === 'autoBackup'}
              onClick={wrap('autoBackup', async () => {
                const r = await runAutoBackup();
                useApp.getState().toast(t('settings.autoBackupDone', { n: r.count, dir: r.dir }), 'success');
              })}
            >
              {t('settings.autoBackupNow')}
            </Button>
          </div>
        </Row>
      )}
      <Row label={t('settings.trashRetention')} hint={t('settings.trashRetentionHint')}>
        <Choice
          label={t('settings.trashRetention')}
          value={prefs.trashRetentionDays}
          onChange={(v) => void savePrefs({ trashRetentionDays: v })}
          options={[0, 7, 30, 90].map((d) => ({ value: d, label: d ? t('settings.trashRetention.days', { n: d }) : t('settings.never') }))}
        />
      </Row>
      <Row label={t('export.title')} hint={t('export.hint')}>
        <Button size="sm" icon={<Download className="size-3.5" />} loading={busy === 'exportAll'} onClick={wrap('exportAll', runExportAll)}>
          {t('export.button')}
        </Button>
      </Row>
      <Row label={t('import.title')} hint={t('import.hint')}>
        <Button size="sm" icon={<Upload className="size-3.5" />} loading={busy === 'import'} onClick={wrap('import', runImport)}>
          {t('import.button')}
        </Button>
      </Row>
      <Row label={t('settings.restore')} hint={t('settings.restoreConfirm')}>
        <Button
          size="sm"
          icon={<Upload className="size-3.5" />}
          loading={busy === 'restore'}
          onClick={wrap('restore', async () => {
            const [f] = await pickFiles('.noesisbak,.zip', false);
            if (!f) return;
            if (!(await confirmDialog(t('settings.restore'), t('settings.restoreConfirm'), { danger: true }))) return;
            // Safety copy of the current data before replacing it.
            if (!(await downloadBackup())) return;
            const manifest = await restoreBackup(repos().db, f.bytes, blobStore);
            await repos().db.flushNow();
            useApp.getState().toast(t('settings.restored', { pages: manifest.tables.pages ?? 0 }), 'success');
            setTimeout(() => location.reload(), 800);
          })}
        >
          {t('settings.restore')}
        </Button>
      </Row>
      <p className="mt-4 text-xs text-muted">{t('settings.syncFuture')}</p>
    </section>
  );
}

function Shortcuts() {
  const t = useT();
  const list: [MessageKey, string][] = [
    ['shortcut.palette', 'Ctrl K'],
    ['capture.shortcut', 'Ctrl Shift Space'],
    ['shortcut.newPage', 'Ctrl Alt N'],
    ['shortcut.search', 'Ctrl Shift F'],
    ['shortcut.sidebar', 'Ctrl \\'],
    ['shortcut.settings', 'Ctrl ,'],
    ['shortcut.theme', 'Ctrl Shift L'],
    ['shortcut.back', 'Alt ←'],
    ['shortcut.forward', 'Alt →'],
    ['shortcut.slash', '/'],
    ['editor.slash.mention', '@  or  [['],
    ['shortcut.bold', 'Ctrl B'],
    ['shortcut.italic', 'Ctrl I'],
    ['shortcut.underline', 'Ctrl U'],
    ['shortcut.code', 'Ctrl E'],
    ['shortcut.undo', 'Ctrl Z'],
    ['shortcut.redo', 'Ctrl Shift Z'],
  ];
  return (
    <section>
      {list.map(([k, v]) => (
        <Row key={k} label={t(k)}>
          <div className="flex gap-1">
            {v.split(' ').filter(Boolean).map((x, i) => (
              <Kbd key={i}>{x}</Kbd>
            ))}
          </div>
        </Row>
      ))}
      <p className="mt-3 text-xs text-muted">Markdown: # ## ### · - · 1. · [] · &gt; · ``` · --- · **bold** · *italic* · `code` · $x^2$</p>
    </section>
  );
}

function Privacy() {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  return (
    <section className="space-y-4">
      <p className="rounded-lg bg-accent-soft/50 p-4 text-sm">{t('settings.privacyIntro')}</p>
      <div>
        <div className="mb-2 text-sm font-medium">{t('settings.privacyConsentList')}</div>
        {prefs.cloudConsents.length === 0 && <p className="text-sm text-muted">{t('settings.noConsents')}</p>}
        {prefs.cloudConsents.map((p) => (
          <Row key={p} label={p}>
            <Button size="sm" onClick={() => void savePrefs({ cloudConsents: prefs.cloudConsents.filter((x) => x !== p) })}>
              {t('settings.revoke')}
            </Button>
          </Row>
        ))}
      </div>
      <p className="text-sm text-muted">{t('settings.telemetry')}</p>
      <p className="text-sm text-muted">{secrets.secure ? t('settings.apiKeySaved') : t('settings.apiKeyPreview')}</p>
    </section>
  );
}

function Notifications() {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  return (
    <section>
      <Row label={t('settings.notifyReminders')}>
        <Switch checked={prefs.notifyReminders} onChange={(v) => void savePrefs({ notifyReminders: v })} />
      </Row>
      <Button className="mt-4" onClick={() => void notify('Noesis', t('settings.testNotification')).then((ok) => !ok && useApp.getState().toast('Notifications are blocked by the system.', 'error'))}>
        {t('settings.testNotification')}
      </Button>
    </section>
  );
}

function Updates() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const prefs = useApp((s) => s.prefs);
  const u = useUpdates();
  if (u.status === 'unsupported')
    return (
      <section className="space-y-2 text-sm">
        <div className="font-medium">{t('settings.version', { v: APP_VERSION })}</div>
        <p className="text-muted">{t('upd.preview')}</p>
      </section>
    );
  return (
    <section className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-medium">{t('settings.version', { v: u.current ?? APP_VERSION })}</div>
        <Button onClick={() => void checkForUpdates({ manual: true })} disabled={u.status === 'checking' || u.status === 'downloading'}>
          <RefreshCw className="size-3.5" /> {u.status === 'checking' ? t('upd.checking') : t('upd.check')}
        </Button>
        {u.status === 'ready' && u.available && (
          <Button variant="primary" onClick={() => void installUpdate()}>
            {t('upd.restart')} ({u.available.version})
          </Button>
        )}
      </div>
      <div className="text-muted">
        {u.status === 'up-to-date' && t('upd.upToDate')}
        {u.status === 'downloading' && u.available && t('upd.downloading', { v: u.available.version, p: Math.round(u.progress * 100) })}
        {u.status === 'ready' && u.available && t('upd.ready', { v: u.available.version })}
        {u.status === 'error' && t('upd.failed', { e: u.error ?? '' })}
        {u.checkedAt && <span className="ml-2 text-faint">· {t('upd.lastChecked', { t: relativeTime(u.checkedAt, lang) })}</span>}
      </div>
      {u.available?.notes && (
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer font-medium">{t('upd.notes')}</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted">{u.available.notes}</pre>
        </details>
      )}
      <Row label={t('upd.auto')} hint={t('upd.autoHint')}>
        <Switch checked={prefs.checkUpdates} onChange={(v) => void setUpdatePrefs({ checkUpdates: v })} label={t('upd.auto')} />
      </Row>
      <Row label={t('upd.autoInstall')} hint={t('upd.autoInstallHint')}>
        <Switch checked={prefs.autoInstallUpdates} onChange={(v) => void setUpdatePrefs({ autoInstallUpdates: v })} label={t('upd.autoInstall')} />
      </Row>
    </section>
  );
}

function Diagnostics() {
  const t = useT();
  const storageKind = useApp((s) => s.storageKind);
  const [out, setOut] = useState<string[]>([]);
  const log = (s: string) => setOut((o) => [...o, `${new Date().toLocaleTimeString()}  ${s}`]);
  return (
    <section className="space-y-3">
      <div className="text-sm text-muted">
        Storage: {storageKind} · schema v{LATEST_VERSION} · {navigator.userAgent.includes('Edg') ? 'WebView2/Edge' : 'browser'} · {navigator.onLine ? 'online' : 'offline'}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            const r = await integrityCheck(repos().db);
            log(r.ok ? t('settings.integrityOk') : `Integrity problems: ${r.messages.join('; ')}`);
          }}
        >
          {t('settings.integrity')}
        </Button>
        <Button
          onClick={async () => {
            const start = performance.now();
            await repos().db.transaction((tx) => rebuildSearchIndex(tx));
            log(`${t('settings.rebuilt')} (${Math.round(performance.now() - start)} ms)`);
          }}
        >
          {t('settings.rebuildIndex')}
        </Button>
        <Button
          onClick={async () => {
            const counts = await repos().db.all<{ n: string; c: number }>(
              "SELECT 'pages' n, COUNT(*) c FROM pages UNION ALL SELECT 'chunks', COUNT(*) FROM source_chunks UNION ALL SELECT 'tasks', COUNT(*) FROM tasks UNION ALL SELECT 'rows', COUNT(*) FROM db_rows",
            );
            log(counts.map((c) => `${c.n}=${c.c}`).join(' '));
          }}
        >
          Stats
        </Button>
      </div>
      <pre className="min-h-24 whitespace-pre-wrap rounded-lg bg-inset p-3 font-mono text-xs">{out.join('\n')}</pre>
    </section>
  );
}
