import { create } from 'zustand';
import type { Repos } from '../core/store';
import type { Lang } from '../i18n';
import type { AiConfig } from '../ai/types';
import { DEFAULT_AI_CONFIG } from '../ai/types';
import type { VisualThemeId } from './visual-themes';
import type { DailyTitleFormat } from '../features/daily-notes/daily';
import { createAgentActivityTracker, type AgentActivityStamp } from './agentActivity';

export type { AgentActivityStamp };

export type Route =
  | { name: 'home' }
  | { name: 'workspace' }
  | { name: 'notes' }
  | { name: 'page'; id: string; blockPos?: number }
  | { name: 'notebooks' }
  | { name: 'notebook'; id: string }
  | { name: 'sources'; id?: string; highlight?: { start: number; end: number } }
  | { name: 'databases' }
  | { name: 'tasks' }
  | { name: 'graph'; tab?: 'graph' | 'activity' }
  | { name: 'search'; q?: string }
  | { name: 'favorites' }
  | { name: 'trash' }
  | { name: 'settings'; section?: string };

export type ThemePref = 'light' | 'dark' | 'system';

export interface McpPermissions {
  create: boolean;
  modify: boolean;
  trash: boolean;
}

export const DEFAULT_MCP_PERMISSIONS: McpPermissions = {
  create: true,
  modify: true,
  trash: true,
};

/** Normalises saved MCP permissions, filling missing or invalid fields with defaults (all allowed). */
export function normalizeMcpPermissions(raw: unknown): McpPermissions {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MCP_PERMISSIONS };
  const obj = raw as Record<string, unknown>;
  return {
    create: typeof obj.create === 'boolean' ? obj.create : DEFAULT_MCP_PERMISSIONS.create,
    modify: typeof obj.modify === 'boolean' ? obj.modify : DEFAULT_MCP_PERMISSIONS.modify,
    trash: typeof obj.trash === 'boolean' ? obj.trash : DEFAULT_MCP_PERMISSIONS.trash,
  };
}

export interface Prefs {
  theme: ThemePref;
  /** Whole-interface visual style; palette and accent remain independently adjustable. */
  visualTheme: VisualThemeId;
  accentHue: number;
  /** Colour palette id (see app/palettes.ts). */
  palette: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  editorFontSize: number;
  fullWidth: boolean;
  /** @deprecated kept so older saved settings migrate to `editorFont`. */
  serif?: boolean;
  /** Interface size in percent (scales every rem-based size). */
  uiScale: number;
  /** Animations: follow the OS setting, always reduce, or always play. */
  motion: 'system' | 'reduce' | 'full';
  editorFont: 'sans' | 'serif' | 'mono';
  lineHeight: 'compact' | 'normal' | 'relaxed';
  spellcheck: boolean;
  showWordCount: boolean;
  /** What opens at start: the home page or the page open when the app was closed. */
  startPage: 'home' | 'last';
  /** First day of the week in calendars and timelines (0 = Sunday, 1 = Monday). */
  weekStart: 0 | 1;
  /** Title style and optional saved-page template used for newly created daily notes. */
  dailyNoteTitleFormat: DailyTitleFormat;
  dailyNoteTemplateId: string | null;
  /** Desktop: keep backups in the app data folder automatically. */
  autoBackup: 'off' | 'daily' | 'weekly';
  autoBackupKeep: number;
  lastAutoBackupAt: number | null;
  /** Take an extra safety snapshot labelled "before AI changes" before destructive MCP actions. */
  backupBeforeAi: boolean;
  lastBeforeAiBackupAt: number | null;
  /** Permanently delete pages that stayed in the trash this many days (0 = never). */
  trashRetentionDays: number;
  notifyReminders: boolean;
  /** Provider ids with standing permission to receive content. */
  cloudConsents: string[];
  onboarded: boolean;
  lastBackupAt: number | null;
  /** Check GitHub for new builds on start and every few hours (desktop only). */
  checkUpdates: boolean;
  /** Install a downloaded update when the app is closed, without asking. */
  autoInstallUpdates: boolean;
  /** Desktop: closing the window hides Noesis in the system tray instead of quitting (Quit from the tray menu). */
  closeToTray: boolean;
  /** Local MCP endpoint for external AI assistants (desktop only). */
  mcpEnabled: boolean;
  /** Apply AI assistants' changes to existing pages without asking. */
  mcpAutoApprove: boolean;
  /** Capability groups enabled for connected MCP assistants (read tools remain on while MCP is enabled). */
  mcpPermissions: McpPermissions;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  visualTheme: 'classic',
  accentHue: 252,
  palette: 'paper',
  sidebarWidth: 264,
  sidebarCollapsed: false,
  editorFontSize: 16,
  fullWidth: false,
  uiScale: 100,
  motion: 'system',
  editorFont: 'sans',
  lineHeight: 'normal',
  spellcheck: true,
  showWordCount: true,
  startPage: 'home',
  weekStart: 1,
  dailyNoteTitleFormat: 'iso',
  dailyNoteTemplateId: null,
  autoBackup: 'off',
  autoBackupKeep: 7,
  lastAutoBackupAt: null,
  backupBeforeAi: true,
  lastBeforeAiBackupAt: null,
  trashRetentionDays: 0,
  notifyReminders: true,
  cloudConsents: [],
  onboarded: false,
  lastBackupAt: null,
  checkUpdates: true,
  autoInstallUpdates: true,
  closeToTray: true,
  mcpEnabled: false,
  mcpAutoApprove: false,
  mcpPermissions: { ...DEFAULT_MCP_PERMISSIONS },
};

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

export interface ConsentRequest {
  providerId: string;
  providerLabel: string;
  resolve: (ok: boolean) => void;
}

interface AppState {
  repos: Repos | null;
  storageKind: 'tauri' | 'wasm' | 'node' | null;
  workspaceId: string | null;
  lang: Lang;
  prefs: Prefs;
  ai: AiConfig;
  hasApiKey: boolean;
  route: Route;
  back: Route[];
  forward: Route[];
  paletteOpen: boolean;
  /** Bumped whenever data that lists depend on changes. */
  version: number;
  toasts: Toast[];
  consent: ConsentRequest | null;
  online: boolean;
  /** Most recent MCP agent write within the 5-minute activity window (cleared on timeout). */
  lastAgentActivity: AgentActivityStamp | null;
  /** Distinct MCP clients active within the last 5 minutes, newest first. */
  activeAgents: AgentActivityStamp[];

  navigate(route: Route, opts?: { replace?: boolean }): void;
  goBack(): void;
  goForward(): void;
  bump(): void;
  toast(message: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(id: number): void;
  setPaletteOpen(open: boolean): void;
  recordAgentActivity(client: string, at?: number): void;
  clearAgentActivity(): void;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => {
  const activityTracker = createAgentActivityTracker({
    onChange: (snap) => set(snap),
  });

  return {
    repos: null,
    storageKind: null,
    workspaceId: null,
    lang: 'en',
    prefs: DEFAULT_PREFS,
    ai: DEFAULT_AI_CONFIG,
    hasApiKey: false,
    route: { name: 'home' },
    back: [],
    forward: [],
    paletteOpen: false,
    version: 0,
    toasts: [],
    consent: null,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    lastAgentActivity: null,
    activeAgents: [],

    navigate(route, opts) {
      const cur = get().route;
      if (JSON.stringify(cur) === JSON.stringify(route)) return;
      if (opts?.replace) set({ route });
      else set({ route, back: [...get().back.slice(-49), cur], forward: [] });
    },
    goBack() {
      const { back, route, forward } = get();
      if (!back.length) return;
      set({ route: back[back.length - 1], back: back.slice(0, -1), forward: [route, ...forward] });
    },
    goForward() {
      const { back, route, forward } = get();
      if (!forward.length) return;
      set({ route: forward[0], forward: forward.slice(1), back: [...back, route] });
    },
    bump() {
      set({ version: get().version + 1 });
    },
    toast(message, kind = 'info', action) {
      const id = ++toastId;
      set({ toasts: [...get().toasts, { id, kind, message, action }] });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000);
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    setPaletteOpen(open) {
      set({ paletteOpen: open });
    },
    recordAgentActivity(client, at) {
      activityTracker.record(client, at);
    },
    clearAgentActivity() {
      activityTracker.clear();
    },
  };
});

/** Typed accessor for repositories once boot has completed. */
export function repos(): Repos {
  const r = useApp.getState().repos;
  if (!r) throw new Error('Storage is not ready');
  return r;
}

export function wsId(): string {
  const id = useApp.getState().workspaceId;
  if (!id) throw new Error('No workspace selected');
  return id;
}
