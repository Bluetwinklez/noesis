# Selectable visual themes

Noesis offers four complete interface styles under **Settings → Appearance**:

- **Classic Noesis** keeps the original compact, neutral interface.
- **Pastel Library** uses warm paper, soft pastel cards and book-like display type.
- **Kawaii Retro** uses candy colours, square controls, pixel-like shadows and a subtle dot grid.
- **Sherwood** uses forest greens, parchment surfaces, rounded panels and serif type.

The styles use CSS tokens and generated gradients rather than bundled reference artwork. They therefore work offline, scale at every interface size and do not redistribute third-party images. Selecting a style also chooses its recommended palette and accent once. The user can subsequently change light/dark mode, any of the eight palettes and the accent colour independently.

## Verification

`tests/unit/visual-themes.test.ts` checks the public style list, palette recommendations and fallback for missing or unknown saved values. `tests/e2e/app.spec.ts` selects all four styles through the real Appearance screen, verifies their root attributes, changes the Sherwood accent independently and reloads the application to verify persistence. The E2E run captures each selected style in its disposable test output for visual inspection.

The automated browser check uses the preview driver. The packaged Windows WebView2 rendering is not driven end to end.
