/**
 * What the window's close button does on desktop.
 * - `install`: a downloaded update installs on close (and restarts the app), so it must not be hidden.
 * - `hide`: keep running in the system tray (quick capture, reminders and the MCP endpoint stay available).
 * - `exit`: close for real.
 */
export type CloseAction = 'install' | 'hide' | 'exit';

export function closeAction({ closeToTray, installUpdate }: { closeToTray: boolean; installUpdate: boolean }): CloseAction {
  if (installUpdate) return 'install';
  return closeToTray ? 'hide' : 'exit';
}
