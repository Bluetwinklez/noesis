import { describe, expect, it } from 'vitest';
import { applyVisualTheme, VISUAL_THEMES, visualThemeById } from '../../src/app/visual-themes';

describe('visual themes', () => {
  it('exposes every complete interface style with a recommended palette', () => {
    expect(VISUAL_THEMES.map((theme) => theme.id)).toEqual(['classic', 'library', 'kawaii', 'sherwood']);
    expect(VISUAL_THEMES.every((theme) => theme.palette.length > 0 && theme.accentHue >= 0 && theme.accentHue < 360)).toBe(true);
  });

  it('applies known styles and safely migrates missing or unknown saved values', () => {
    const root = { dataset: {} } as HTMLElement;
    for (const theme of VISUAL_THEMES) {
      applyVisualTheme(root, theme.id);
      expect(root.dataset.visualTheme).toBe(theme.id);
    }

    expect(visualThemeById(undefined).id).toBe('classic');
    expect(visualThemeById('removed-theme').id).toBe('classic');
    applyVisualTheme(root, 'untrusted-value');
    expect(root.dataset.visualTheme).toBe('classic');
  });
});
