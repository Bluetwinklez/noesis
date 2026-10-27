import { create } from 'zustand';
import type { Repos } from '../core/store';
import type { Lang } from '../i18n';
import type { AiConfig } from '../ai/types';
import { DEFAULT_AI_CONFIG } from '../ai/types';

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
  | { name: 'graph' }
  | { name: 'search'; q?: string }
  | { name: 'favorites' }
  | { name: 'trash' }
  | { name: 'settings'; section?: string };

export type ThemePref = 'light' | 'dark' | 'system';

export interface Prefs {
  theme: ThemePref;
  accentHue: number;
  /** Colour palette id (see app/palettes.ts). */
  palette: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  editorFontSize: number;
  fullWidth: boolean;
  serif: boolean;
  notifyReminders: boolean;
  /** Provider ids with standing permission to receive content. */
  cloudConsents: string[];
  onboarded: boolean;
  lastBackupAt: number | null;
  /** Check GitHub for new builds on start and every few hours (desktop only). */
  checkUpdates: boolean;
  /** Install a downloaded update when the app is closed, without asking. */
  autoInstallUpdates: boolean;
  /** Local MCP endpoint for external AI assistants (desktop only). */
  mcpEnabled: boolean;
  /** Apply AI assistants' changes to existing pages without asking. */
  mcpAutoApprove: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  accentHue: 252,
  palette: 'paper',
  sidebarWidth: 264,
  sidebarCollapsed: false,
  editorFontSize: 16,
  fullWidth: false,
  serif: false,
  notifyReminders: true,
  cloudConsents: [],
  onboarded: false,
  lastBackupAt: null,
  checkUpdates: true,
  autoInstallUpdates: true,
  mcpEnabled: false,
  mcpAutoApprove: false,
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

  navigate(route: Route, opts?: { replace?: boolean }): void;
  goBack(): void;
  goForward(): void;
  bump(): void;
  toast(message: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(id: number): void;
  setPaletteOpen(open: boolean): void;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
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
}));

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
