export type VisualThemeId = 'classic' | 'library' | 'kawaii' | 'sherwood';

export interface VisualTheme {
  id: VisualThemeId;
  palette: string;
  accentHue: number;
}

export const VISUAL_THEMES: VisualTheme[] = [
  { id: 'classic', palette: 'paper', accentHue: 252 },
  { id: 'library', palette: 'paper', accentHue: 35 },
  { id: 'kawaii', palette: 'rose', accentHue: 315 },
  { id: 'sherwood', palette: 'forest', accentHue: 92 },
];

export const visualThemeById = (id: string | undefined) => VISUAL_THEMES.find((theme) => theme.id === id) ?? VISUAL_THEMES[0];

/** Sets a validated data attribute; all visual values remain trusted CSS constants. */
export function applyVisualTheme(root: HTMLElement, id: string | undefined) {
  root.dataset.visualTheme = visualThemeById(id).id;
}
