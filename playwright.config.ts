import { defineConfig } from '@playwright/test';

/**
 * E2E tests drive the real UI in the browser-preview build (SQLite WASM +
 * IndexedDB). The desktop shell (Rust IPC) is covered by `cargo test` and
 * manual installer checks; see docs/testing/README.md.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:1420',
    channel: process.env.PW_CHANNEL ?? 'msedge',
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'npm run dev', url: 'http://localhost:1420', reuseExistingServer: true, timeout: 60_000 },
    { command: 'node scripts/mock-ai-server.mjs 11435', url: 'http://127.0.0.1:11435/health', reuseExistingServer: true },
  ],
});
