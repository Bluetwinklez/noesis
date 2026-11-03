import { describe, expect, it } from 'vitest';
import { closeAction } from '../../src/app/closeBehavior';
import { DEFAULT_PREFS } from '../../src/app/state';

describe('what the window close button does', () => {
  it('hides the window into the tray by default so the app keeps running', () => {
    expect(DEFAULT_PREFS.closeToTray).toBe(true);
    expect(closeAction({ closeToTray: DEFAULT_PREFS.closeToTray, installUpdate: false })).toBe('hide');
  });

  it('exits for real when the user turned the tray behaviour off', () => {
    expect(closeAction({ closeToTray: false, installUpdate: false })).toBe('exit');
  });

  it('a downloaded update that installs on close wins over hiding, otherwise it would never install', () => {
    expect(closeAction({ closeToTray: true, installUpdate: true })).toBe('install');
    expect(closeAction({ closeToTray: false, installUpdate: true })).toBe('install');
  });
});
