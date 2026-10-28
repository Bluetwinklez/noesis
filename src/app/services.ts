import { useApp, repos, wsId, DEFAULT_PREFS, type Prefs } from './state';
import { createProvider } from '../ai/providers';
import { AiError, DEFAULT_AI_CONFIG, PROVIDER_DEFAULTS, type AiConfig, type AiProvider, type ProviderId } from '../ai/types';
import { blobStore, fetchPublicUrl, notify, secrets } from '../lib/platform';
import { IngestionPipeline } from '../ingestion/pipeline';
import { getPdfJsLoader } from '../ingestion/extractors';
import { applyPalette } from './palettes';
import { t } from '../i18n';
import type { Lang } from '../i18n';
import { applyVisualTheme, visualThemeById } from './visual-themes';

export const apiKeyName = (p: ProviderId) => `ai.${p}.apiKey`;

let prefsSaveQueue: Promise<void> = Promise.resolve();

export async function savePrefs(patch: Partial<Prefs>) {
  const prefs = { ...useApp.getState().prefs, ...patch };
  useApp.setState({ prefs });
  applyTheme(prefs);
  // Fast consecutive controls (for example style then accent) must reach storage
  // in the same order in which the UI applied them.
  prefsSaveQueue = prefsSaveQueue.catch(() => undefined).then(() => repos().settings.set('prefs', prefs));
  await prefsSaveQueue;
}

export async function saveLang(lang: Lang) {
  useApp.setState({ lang });
  document.documentElement.lang = lang;
  await repos().settings.set('lang', lang);
}

export async function saveAiConfig(config: AiConfig) {
  useApp.setState({ ai: config });
  await repos().settings.set('ai', config);
  useApp.setState({ hasApiKey: config.provider === 'none' ? false : !!(await secrets.get(apiKeyName(config.provider))) });
}

export function configForProvider(id: ProviderId, current: AiConfig): AiConfig {
  if (id === 'none') return { ...current, provider: 'none' };
  return { ...DEFAULT_AI_CONFIG, ...PROVIDER_DEFAULTS[id], provider: id, temperature: current.temperature };
}

export async function loadSettings() {
  const r = repos();
  const stored = await r.settings.get<Partial<Prefs>>('prefs', {});
  const prefs = { ...DEFAULT_PREFS, ...stored };
  prefs.visualTheme = visualThemeById(stored.visualTheme).id;
  // Older versions had a serif on/off switch.
  if (!stored.editorFont && stored.serif) prefs.editorFont = 'serif';
  delete prefs.serif;
  const lang = await r.settings.get<Lang>('lang', navigator.language?.startsWith('tr') ? 'tr' : 'en');
  const ai = { ...DEFAULT_AI_CONFIG, ...(await r.settings.get<Partial<AiConfig>>('ai', {})) };
  const workspaceId = await r.settings.get<string | null>('workspaceId', null);
  const hasApiKey = ai.provider !== 'none' && !!(await secrets.get(apiKeyName(ai.provider)).catch(() => null));
  useApp.setState({ prefs, lang, ai, hasApiKey, workspaceId });
  document.documentElement.lang = lang;
  applyTheme(prefs);
}

export function applyTheme(prefs: Prefs) {
  const root = document.documentElement;
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  applyVisualTheme(root, prefs.visualTheme);
  applyPalette(root, prefs.palette, dark);
  root.style.setProperty('--accent-h', String(prefs.accentHue));
  root.style.setProperty('--editor-font-size', `${prefs.editorFontSize}px`);
  root.style.fontSize = prefs.uiScale === 100 ? '' : `${prefs.uiScale}%`;
  root.style.setProperty('--editor-line-height', LINE_HEIGHTS[prefs.lineHeight] ?? LINE_HEIGHTS.normal);
  root.style.setProperty('--editor-font', `var(${EDITOR_FONTS[prefs.editorFont] ?? EDITOR_FONTS.sans})`);
  root.classList.toggle('reduce-motion', prefs.motion === 'reduce' || (prefs.motion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
}

const LINE_HEIGHTS: Record<Prefs['lineHeight'], string> = { compact: '1.5', normal: '1.7', relaxed: '1.95' };
const EDITOR_FONTS: Record<Prefs['editorFont'], string> = { sans: '--font-sans', serif: '--font-serif', mono: '--font-mono' };

/** Builds the active provider, or null when AI is off. */
export async function activeProvider(): Promise<AiProvider | null> {
  const { ai } = useApp.getState();
  if (ai.provider === 'none') return null;
  const key = await secrets.get(apiKeyName(ai.provider)).catch(() => null);
  return createProvider(ai, key);
}

/**
 * Returns a provider that the user allowed to receive content.
 * Cloud providers need standing or one-time consent; local servers do not.
 */
export async function providerWithConsent(): Promise<AiProvider> {
  const provider = await activeProvider();
  if (!provider) throw new AiError('not_configured', t('ai.notConfigured'));
  if (!provider.isCloud) return provider;
  const { prefs } = useApp.getState();
  if (prefs.cloudConsents.includes(provider.id)) return provider;
  const ok = await new Promise<boolean>((resolve) => {
    useApp.setState({ consent: { providerId: provider.id, providerLabel: provider.label, resolve } });
  });
  useApp.setState({ consent: null });
  if (!ok) throw new AiError('consent', t('ai.denied'));
  return provider;
}

/** Variant for background jobs: never prompts, only uses standing consent. */
async function providerForBackground(): Promise<AiProvider | null> {
  const provider = await activeProvider();
  if (!provider) return null;
  if (!provider.isCloud) return provider;
  return useApp.getState().prefs.cloudConsents.includes(provider.id) ? provider : null;
}

let pipeline: IngestionPipeline | null = null;
export function ingestion(): IngestionPipeline {
  if (!pipeline) {
    const r = repos();
    pipeline = new IngestionPipeline({
      sources: r.sources,
      attachments: r.attachments,
      blobs: blobStore,
      getProvider: async (purpose) => {
        // OCR / transcription are explicit user actions on that file: ask if needed.
        if (purpose === 'embeddings') return providerForBackground();
        try {
          return await providerWithConsent();
        } catch {
          return null;
        }
      },
      fetchUrl: (url, signal) => fetchPublicUrl(url, { signal, headers: { Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5' } }),
      ocr: {
        image: async (bytes, mime, signal) => (await (await import('../ingestion/ocr')).ocrImage(new Blob([bytes as BlobPart], { type: mime }), signal)).text,
        pdf: async (bytes, signal) => {
          const loader = getPdfJsLoader();
          if (!loader) return [];
          const pages = await (await import('../ingestion/ocr')).ocrPdf(bytes, loader as never, signal);
          return pages.map((p) => ({ pageNumber: p.pageNumber ?? 0, text: p.text }));
        },
      },
      onProgress: () => useApp.getState().bump(),
    });
  }
  return pipeline;
}

export function errorMessage(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function reportError(e: unknown) {
  const msg = errorMessage(e);
  const ai = e instanceof AiError;
  console.error(e);
  useApp.getState().toast(
    msg,
    'error',
    ai && (e.code === 'auth' || e.code === 'not_configured')
      ? { label: t('ai.openSettings'), run: () => useApp.getState().navigate({ name: 'settings', section: 'ai' }) }
      : undefined,
  );
}

/** Polls due task reminders and shows OS notifications. */
export function startReminderLoop() {
  const tick = async () => {
    const st = useApp.getState();
    if (!st.repos || !st.prefs.notifyReminders) return;
    try {
      for (const task of await st.repos.tasks.dueReminders()) {
        await notify(t('task.reminderTitle'), task.title);
        await st.repos.tasks.markNotified(task.id);
      }
    } catch (e) {
      console.warn('reminder loop', e);
    }
  };
  void tick();
  return window.setInterval(tick, 30_000);
}

export async function setWorkspace(id: string) {
  useApp.setState({ workspaceId: id, route: { name: 'home' }, back: [], forward: [] });
  await repos().settings.set('workspaceId', id);
  useApp.getState().bump();
}

export { wsId };
