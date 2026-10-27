/**
 * Colour palettes. Each palette defines surface/text colours for light and dark
 * mode; the accent colour stays independent (Settings → Accent colour), and
 * every palette suggests an accent that suits it. Applied as CSS custom
 * properties on <html>, so all components follow automatically.
 */

export type PaletteId = 'paper' | 'slate' | 'nord' | 'solarized' | 'forest' | 'rose' | 'midnight' | 'contrast';

interface Surface {
  bg: string;
  elevated: string;
  sidebar: string;
  inset: string;
  text: string;
  muted: string;
  faint: string;
  /** RGB triplet used for hover/border overlays, e.g. "30, 25, 15". */
  ink: string;
}

export interface Palette {
  id: PaletteId;
  accentHue: number;
  light: Surface;
  dark: Surface;
}

export const PALETTES: Palette[] = [
  {
    id: 'paper',
    accentHue: 252,
    light: { bg: '#fbfaf8', elevated: '#ffffff', sidebar: '#f4f2ee', inset: '#f1efea', text: '#23211d', muted: '#6f6a61', faint: '#a29d93', ink: '30, 25, 15' },
    dark: { bg: '#17171a', elevated: '#1f1f23', sidebar: '#131316', inset: '#1b1b1f', text: '#ecebe8', muted: '#a3a19c', faint: '#6d6b67', ink: '255, 255, 255' },
  },
  {
    id: 'slate',
    accentHue: 212,
    light: { bg: '#f8fafc', elevated: '#ffffff', sidebar: '#f1f5f9', inset: '#eef2f6', text: '#0f172a', muted: '#526077', faint: '#94a3b8', ink: '15, 23, 42' },
    dark: { bg: '#0f141c', elevated: '#161d27', sidebar: '#0b1017', inset: '#131a23', text: '#e5eaf1', muted: '#9aa7b8', faint: '#5f6b7c', ink: '226, 232, 240' },
  },
  {
    id: 'nord',
    accentHue: 193,
    light: { bg: '#eceff4', elevated: '#f6f8fb', sidebar: '#e5e9f0', inset: '#e0e5ed', text: '#2e3440', muted: '#4c566a', faint: '#8a93a5', ink: '46, 52, 64' },
    dark: { bg: '#2e3440', elevated: '#3b4252', sidebar: '#292e39', inset: '#353c4a', text: '#eceff4', muted: '#c0c8d6', faint: '#7b8496', ink: '216, 222, 233' },
  },
  {
    id: 'solarized',
    accentHue: 205,
    light: { bg: '#fdf6e3', elevated: '#fffbf0', sidebar: '#eee8d5', inset: '#f3ecd9', text: '#3b4a50', muted: '#657b83', faint: '#93a1a1', ink: '7, 54, 66' },
    dark: { bg: '#002b36', elevated: '#073642', sidebar: '#00242e', inset: '#05313c', text: '#e4dcc4', muted: '#93a1a1', faint: '#5f7a80', ink: '238, 232, 213' },
  },
  {
    id: 'forest',
    accentHue: 152,
    light: { bg: '#f7faf6', elevated: '#ffffff', sidebar: '#eef4ec', inset: '#e9f0e6', text: '#1d2a1f', muted: '#5b6b5c', faint: '#98a697', ink: '20, 45, 25' },
    dark: { bg: '#121815', elevated: '#19211c', sidebar: '#0e1411', inset: '#161d19', text: '#e3ebe4', muted: '#9fb1a2', faint: '#637266', ink: '220, 240, 225' },
  },
  {
    id: 'rose',
    accentHue: 340,
    light: { bg: '#fdf8f8', elevated: '#ffffff', sidebar: '#f8eeef', inset: '#f5e9ea', text: '#2b1f22', muted: '#77636a', faint: '#b09ba2', ink: '60, 20, 30' },
    dark: { bg: '#1a1416', elevated: '#231b1e', sidebar: '#151012', inset: '#1f181b', text: '#f1e7e9', muted: '#b7a2a8', faint: '#78656a', ink: '255, 230, 236' },
  },
  {
    id: 'midnight',
    accentHue: 262,
    light: { bg: '#f6f7fb', elevated: '#ffffff', sidebar: '#eceef7', inset: '#e8eaf4', text: '#1b1d2e', muted: '#5e6280', faint: '#9a9db8', ink: '27, 29, 46' },
    dark: { bg: '#000000', elevated: '#0d0d12', sidebar: '#050507', inset: '#0a0a0e', text: '#e8e8f0', muted: '#9a9ab0', faint: '#5c5c70', ink: '220, 220, 255' },
  },
  {
    id: 'contrast',
    accentHue: 222,
    light: { bg: '#ffffff', elevated: '#ffffff', sidebar: '#f2f2f2', inset: '#ededed', text: '#000000', muted: '#333333', faint: '#5c5c5c', ink: '0, 0, 0' },
    dark: { bg: '#000000', elevated: '#0a0a0a', sidebar: '#000000', inset: '#111111', text: '#ffffff', muted: '#dddddd', faint: '#aaaaaa', ink: '255, 255, 255' },
  },
];

export const paletteById = (id: string | undefined) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

/** Writes the palette's surface variables onto <html> (palette ids are validated, values are constants). */
export function applyPalette(root: HTMLElement, id: string | undefined, dark: boolean) {
  const p = paletteById(id);
  const s = dark ? p.dark : p.light;
  const strong = p.id === 'contrast';
  const vars: Record<string, string> = {
    '--bg': s.bg,
    '--bg-elevated': s.elevated,
    '--bg-sidebar': s.sidebar,
    '--bg-inset': s.inset,
    '--text': s.text,
    '--text-muted': s.muted,
    '--text-faint': s.faint,
    '--bg-hover': `rgba(${s.ink}, ${dark ? 0.06 : 0.05})`,
    '--bg-active': `rgba(${s.ink}, ${dark ? 0.1 : 0.08})`,
    '--border': `rgba(${s.ink}, ${strong ? 0.45 : dark ? 0.09 : 0.1})`,
    '--border-strong': `rgba(${s.ink}, ${strong ? 0.7 : dark ? 0.17 : 0.18})`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.palette = p.id;
}
