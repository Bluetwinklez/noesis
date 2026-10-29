import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repos } from '../../src/core/store';

const FIX = join(import.meta.dirname, '..', 'fixtures');
const MOCK_URL = 'http://127.0.0.1:11435/v1';

/** Every test gets its own browser database so runs are independent. */
async function freshApp(page: Page, name = test.info().title) {
  const db = `e2e-${name.replace(/\W+/g, '-')}-${Date.now()}`;
  await page.goto(`/?db=${db}`);
  return db;
}

async function onboard(page: Page, opts: { sample?: boolean } = {}) {
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Name your workspace').fill('E2E Workspace');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click(); // appearance
  await page.getByRole('button', { name: 'Skip' }).click(); // AI optional
  await page.getByRole('button', { name: opts.sample ? 'Add sample content' : 'Start empty' }).click();
  await page.getByRole('button', { name: 'Next' }).click(); // editor intro
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
}

async function newPage(page: Page, title: string) {
  await page.getByRole('button', { name: 'New page' }).first().click();
  const t = page.getByLabel('Page title');
  await t.fill(title);
  return t;
}

const editor = (page: Page) => page.getByLabel('Page content');

async function configureMockAi(page: Page, key = 'test-key') {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'AI providers' }).click();
  await page.getByLabel('Provider').selectOption('custom');
  await page.getByLabel('Server URL').fill(MOCK_URL);
  await page.getByLabel('Chat model').fill('mock-chat');
  await page.getByLabel('Embedding model').fill('mock-embed');
  await page.getByLabel('Text-to-speech model').fill('mock-tts');
  await page.getByLabel('API key').fill(key);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

test('complete visual themes are selectable and survive a restart', async ({ page }) => {
  const db = await freshApp(page);
  await onboard(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();

  for (const [label, id] of [
    ['Pastel Library', 'library'],
    ['Kawaii Retro', 'kawaii'],
    ['Sherwood', 'sherwood'],
    ['Classic Noesis', 'classic'],
  ] as const) {
    await page.getByRole('radio', { name: label }).click();
    await expect(page.locator('html')).toHaveAttribute('data-visual-theme', id);
    await expect(page.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: test.info().outputPath(`${id}-theme.png`), fullPage: true });
  }

  await page.getByRole('radio', { name: 'Sherwood' }).click();
  await page.getByRole('button', { name: 'Accent hue 220' }).click();
  await expect(page.locator('html')).toHaveAttribute('style', /--accent-h:\s*220/);
  await expect.poll(() => page.evaluate(async () => {
    const state = (window as unknown as { __noesis: { getState(): { repos: Repos } } }).__noesis.getState();
    const saved = await state.repos.settings.get<{ visualTheme?: string; accentHue?: number }>('prefs', {});
    await state.repos.db.flushNow();
    return { visualTheme: saved.visualTheme, accentHue: saved.accentHue };
  })).toEqual({ visualTheme: 'sherwood', accentHue: 220 });
  await page.goto(`/?db=${db}`);
  await expect(page.locator('html')).toHaveAttribute('data-visual-theme', 'sherwood');
  await expect(page.locator('html')).toHaveAttribute('style', /--accent-h:\s*220/);
});

async function importFixture(page: Page, button: string, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).first().click();
  await (await chooser).setFiles(join(FIX, file));
}

test('create nested formatted pages that survive a restart', async ({ page }) => {
  const db = await freshApp(page);
  await onboard(page);
  await newPage(page, 'Parent page');
  await editor(page).click();
  await page.keyboard.type('# Heading one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain then ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold words');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- bullet item');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/todo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('checklist item');
  await expect(editor(page).locator('h1')).toHaveText('Heading one');
  await expect(editor(page).locator('strong')).toHaveText('bold words');

  // Nested page via the sidebar "add sub-page" button.
  await page.getByRole('treeitem', { name: /Parent page/ }).hover();
  await page.getByRole('treeitem', { name: /Parent page/ }).getByRole('button', { name: 'Add sub-page' }).click();
  await page.getByLabel('Page title').fill('Child page');
  await editor(page).click();
  await page.keyboard.type('Child body text');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Parent page');
  await expect(page.getByText('Saved')).toBeVisible();

  // "Restart": reload the app from storage.
  await page.waitForTimeout(600);
  await page.goto(`/?db=${db}`);
  await page.getByRole('treeitem', { name: /Parent page/ }).click();
  await expect(editor(page).locator('h1')).toHaveText('Heading one');
  await expect(editor(page).locator('strong')).toHaveText('bold words');
  await expect(editor(page).locator('ul[data-type="taskList"]')).toContainText('checklist item');
  await expect(page.getByText('Child page').first()).toBeVisible();
});

test('import a PDF, inspect extracted text and find it in search', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await page.getByRole('button', { name: 'Sources' }).click();
  await importFixture(page, 'Import files', 'sample.pdf');
  await expect(page.getByText('Photosynthesis Field Notes').first()).toBeVisible();
  await expect(page.getByText('Ready').first()).toBeVisible({ timeout: 20_000 });
  await page.getByText('Photosynthesis Field Notes').first().click();
  await expect(page.getByLabel('Extracted text')).toContainText('Calvin cycle');
  await expect(page.getByLabel('Extracted text')).toContainText('2 pages');

  // A malformed file must fail visibly.
  await importFixture(page, 'Import files', 'fake.pdf');
  await expect(page.getByText(/does not look like a PDF/).first()).toBeVisible();

  await newPage(page, 'Chloroplast notes');
  await editor(page).click();
  await page.keyboard.type('Thylakoid membranes host the light reactions.');
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search pages, notes, documents, tasks…').fill('thylakoid');
  const results = page.getByRole('listbox');
  await expect(results).toContainText('Chloroplast notes');
  await expect(results).toContainText('Document passage');
});

test('startup flags interrupted source processing and the existing reprocess action recovers it', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await importFixture(page, 'Import files', 'sample.pdf');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 20_000 });
  // Persist the state left by a process stopped during PDF/OCR extraction.
  await page.evaluate(async () => {
    const state = (window as unknown as { __noesis: { getState(): { repos: Repos; workspaceId: string } } }).__noesis.getState();
    const source = (await state.repos.sources.list(state.workspaceId))[0];
    await state.repos.sources.setStatus(source.id, 'processing', 'extraction');
    await state.repos.db.flushNow();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await expect(page.getByText('Processing interrupted — retry', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Source actions' }).click();
  await page.getByRole('menuitem', { name: 'Reprocess' }).click();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Processing interrupted — retry', { exact: true })).toHaveCount(0);
  await page.getByText('Photosynthesis Field Notes', { exact: true }).click();
  await expect(page.getByLabel('Extracted text')).toContainText('RuBisCO');
});

test('source-grounded notebook answer with navigable citations', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await configureMockAi(page);
  await page.getByRole('button', { name: 'AI Notebooks' }).click();
  await page.getByRole('button', { name: 'New notebook' }).first().click();
  await importFixture(page, 'Import files', 'sample.pdf');
  await expect(page.getByLabel('Use Photosynthesis Field Notes')).toBeEnabled({ timeout: 20_000 });
  const ask = page.getByLabel('Ask a question about the selected sources…');
  await ask.fill('Which enzyme catalyses carbon fixation?');
  await ask.press('Enter');
  await expect(page.getByText('Sources used')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-evidence="uncited"]').first()).toBeVisible();
  await expect(page.getByText(/RuBisCO|Calvin|chloroplast|Photosynthesis/i).first()).toBeVisible();
  // Fabricated marker [9] must be removed.
  await expect(page.getByText('[9]')).toHaveCount(0);
  await page.getByRole('button', { name: /Photosynthesis Field Notes · p\. \d/ }).first().click();
  await expect(page.locator('mark')).toBeVisible();

  // Edit an AI-generated note.
  await page.getByRole('button', { name: 'AI Notebooks' }).click();
  await page.getByRole('button', { name: /Untitled notebook/ }).click();
  await page.getByRole('tab', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Summary' }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Note body (Markdown)').fill('Edited summary text');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Edited summary text');
});

test('Studio condenses a long source and preserves its coverage note after reload', async ({ page }) => {
  const db = await freshApp(page);
  await onboard(page);
  await configureMockAi(page);
  await page.getByRole('button', { name: 'AI Notebooks' }).click();
  await page.getByRole('button', { name: 'New notebook' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import files', exact: true }).first().click();
  await (await chooser).setFiles({ name: 'Long field report.txt', mimeType: 'text/plain', buffer: Buffer.from('The excavation project carefully catalogues ancient artefacts. '.repeat(2000) + '\nFINAL FINDING: 731 artefacts were recovered in Izmir.') });
  await expect(page.getByLabel('Use Long field report')).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status', { name: 'Source coverage' })).toContainText(/Long source condensed in \d+ parts/, { timeout: 30000 });
  await expect(dialog).toContainText('Citations open the original sources');
  await page.keyboard.press('Escape');
  await page.goto(`/?db=${db}`);
  await page.getByRole('button', { name: 'AI Notebooks' }).click();
  await page.getByRole('button', { name: /Untitled notebook/ }).click();
  await page.getByRole('tab', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: /Summary/ }).last().click();
  await expect(page.getByRole('dialog').getByRole('status', { name: 'Source coverage' })).toContainText('Long source condensed');
});

test('unsupported and uncited answers show a persisted evidence warning', async ({ page }) => {
  const db = await freshApp(page);
  await onboard(page);
  await configureMockAi(page);
  await page.getByRole('button', { name: 'AI Notebooks' }).click();
  await page.getByRole('button', { name: 'New notebook' }).first().click();
  await importFixture(page, 'Import files', 'sample.pdf');
  await expect(page.getByLabel('Use Photosynthesis Field Notes')).toBeEnabled({ timeout: 20000 });
  const ask = page.getByLabel('Ask a question about the selected sources…');
  await ask.fill('Which enzyme catalyses carbon fixation? NOESIS_UNCITED_REPLY');
  await ask.press('Enter');
  await expect(page.getByRole('note').filter({ hasText: 'No source supports this answer' })).toHaveCount(1);
  await ask.fill('Which city hosted the 2012 Olympics?');
  await ask.press('Enter');
  await expect(page.getByRole('note').filter({ hasText: 'No source supports this answer' })).toHaveCount(2);
  await page.goto(`/?db=${db}`);
  await page.getByRole('button', { name: 'AI Notebooks' }).click();
  await page.getByRole('button', { name: /Untitled notebook/ }).click();
  await expect(page.getByRole('note').filter({ hasText: 'No source supports this answer' })).toHaveCount(2);
});

test('invalid API key produces a recoverable error', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await configureMockAi(page, 'wrong-key');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'rejected the API key' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'wrong-key' })).toHaveCount(0);
  await page.getByLabel('API key').fill('test-key');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Connection works/)).toBeVisible();
});

test('AI edits are previewed and only applied after acceptance', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await configureMockAi(page);
  await newPage(page, 'Draft');
  await editor(page).click();
  await page.keyboard.type('this sentence need improvement');
  await editor(page).locator('p').first().click({ clickCount: 3 });
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Improve writing' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Improved:');
  await expect(editor(page)).toHaveText('this sentence need improvement');
  await dlg.getByRole('button', { name: 'Replace selection' }).click();
  await expect(editor(page)).toContainText('Improved:');
});

test('backup export and restore', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await newPage(page, 'Before backup');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Storage & backups' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Create backup' }).click();
  const backupPath = test.info().outputPath('backup.noesisbak');
  await (await dl).saveAs(backupPath);
  expect(readFileSync(backupPath).subarray(0, 2).toString()).toBe('PK');

  await newPage(page, 'After backup');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Storage & backups' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  await (await chooser).setFiles(backupPath);
  const safety = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
  await safety;
  await expect(page.getByText(/Backup restored/)).toBeVisible();
  await page.waitForLoadState('load');
  await expect(page.getByRole('treeitem', { name: /Before backup/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('treeitem', { name: /After backup/ })).toHaveCount(0);
});

test('a throwing view shows recovery while sidebar navigation and retry keep working', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await page.evaluate(() => {
    const app = (window as unknown as { __noesis: { getState(): { repos: Repos } } }).__noesis;
    const original = app.getState().repos.notebooks.list.bind(app.getState().repos.notebooks);
    // Inject invalid render results in this test's memory; never change stored data.
    (window as unknown as { __restoreNotebookList: () => void }).__restoreNotebookList = () => { app.getState().repos.notebooks.list = original; };
    app.getState().repos.notebooks.list = async () => [{ id: 'synthetic', title: { unexpected: true }, updated_at: Date.now() }] as unknown as Awaited<ReturnType<typeof original>>;
  });
  await page.getByRole('button', { name: 'AI Notebooks', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This view could not be displayed');
  await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'AI Notebooks', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This view could not be displayed');
  await page.evaluate(() => (window as unknown as { __restoreNotebookList: () => void }).__restoreNotebookList());
  await page.getByRole('button', { name: 'Reload view', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI Notebooks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('a corrupt database opens independent recovery and restores a backup', async ({ page }) => {
  const key = await freshApp(page);
  await onboard(page);
  await newPage(page, 'Recovery treasure');
  await editor(page).click();
  await page.keyboard.type('This text returns from the backup.');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Storage & backups', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Create backup', exact: true }).click();
  const backup = await downloadEvent;
  const path = await backup.path();
  expect(path).toBeTruthy();
  await page.evaluate(async (dbKey) => {
    // Write only this test's isolated snapshot. No installed application data is used.
    const state = (window as unknown as { __noesis: { getState(): { repos: Repos } } }).__noesis.getState();
    await state.repos.db.flushNow();
    // Simulate an already terminated writer so pagehide cannot overwrite the fixture.
    state.repos.db.driver.flush = async () => {};
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('noesis-storage', 1);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put(new TextEncoder().encode('corrupt SQLite fixture'), dbKey);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }, key);
  await page.reload();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Database recovery' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('recovery-screen.png') });
  // Failed restores leave the raw bytes available for export and another attempt.
  let chooser = page.waitForEvent('filechooser');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await (await chooser).setFiles({ name: 'bad.noesisbak', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid archive') });
  await expect(page.getByRole('alert')).toContainText('not a valid Noesis backup');
  const rawEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export raw database' }).click();
  const raw = await rawEvent;
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(readFileSync((await raw.path())!));
  expect(await zip.file('noesis.db')!.async('string')).toBe('corrupt SQLite fixture');
  chooser = page.waitForEvent('filechooser');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await (await chooser).setFiles(path!);
  await page.getByRole('treeitem', { name: /Recovery treasure/ }).click();
  await expect(editor(page)).toContainText('This text returns from the backup.');
  const preserved = await page.evaluate(async (dbKey) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open('noesis-storage', 1); req.onsuccess = () => resolve(req.result); });
    return new Promise<boolean>((resolve) => {
      const req = db.transaction('snapshots').objectStore('snapshots').getAllKeys();
      req.onsuccess = () => { db.close(); resolve(req.result.some((k) => String(k).startsWith(`${dbKey}.pre-recovery-`))); };
    });
  }, key);
  expect(preserved).toBe(true);
});

test('local editing keeps working offline', async ({ page, context }) => {
  const db = await freshApp(page);
  await onboard(page);
  // Load lazily-split screens once so the dev server is not needed while offline.
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await newPage(page, 'Offline page');
  await context.setOffline(true);
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await editor(page).click();
  await page.keyboard.type('written without a connection');
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search pages, notes, documents, tasks…').fill('connection');
  await expect(page.getByRole('listbox')).toContainText('Offline page');
  await page.waitForTimeout(500);
  await context.setOffline(false);
  await page.goto(`/?db=${db}`);
  await page.getByRole('treeitem', { name: /Offline page/ }).click();
  await expect(editor(page)).toContainText('written without a connection');
});

test('audio overview with a TTS-capable provider', async ({ page }) => {
  await freshApp(page);
  await onboard(page, { sample: true });
  await configureMockAi(page);
  await page.getByRole('button', { name: 'AI Notebooks' }).click();
  await page.getByRole('button', { name: /Beekeeping research/ }).click();
  await page.getByRole('button', { name: 'Generate audio overview' }).click();
  await expect(page.locator('audio')).toHaveCount(1, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Transcript' }).click();
  await expect(page.getByText(/Welcome\./)).toBeVisible();
});

test('command palette, keyboard shortcuts, trash and restore', async ({ page }) => {
  await freshApp(page);
  await onboard(page, { sample: true });
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search or run a command…').fill('Welcome');
  await expect(page.getByRole('option', { name: /Welcome tour/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Page title')).toHaveValue('Welcome tour');
  await page.getByRole('button', { name: 'Page menu' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('button', { name: 'Trash' }).click();
  await expect(page.getByText('Welcome tour')).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await expect(page.getByRole('treeitem', { name: /Welcome tour/ })).toBeVisible();
  // Database views persist.
  await page.getByRole('treeitem', { name: /Projects/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /Reading list/ }).click();
  await page.getByRole('tab', { name: /Board/ }).click();
  await expect(page.getByText('Kürk Mantolu Madonna')).toBeVisible();
});

test('pasting plain-text markdown creates structured blocks', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await newPage(page, 'Pasted notes');
  await editor(page).click();
  await editor(page).evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '## Agenda\n\n- first point\n- second point\n\nNext steps:\n\n- [ ] follow up');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(editor(page).locator('h2')).toHaveText('Agenda');
  await expect(editor(page).locator('ul:not([data-type]) li')).toHaveCount(2);
  await expect(editor(page).locator('ul[data-type="taskList"]')).toContainText('follow up');
  await expect(editor(page)).not.toContainText('## Agenda');
});

test('import a Notion export with nested pages, links and a database', async ({ page }) => {
  const JSZip = (await import('jszip')).default;
  const z = new JSZip();
  const id = '0123456789abcdef0123456789abcdef';
  z.file(`Export-1/Garden ${id}.md`, `# Garden\n\nSee [Seeds](Garden%20${id}/Seeds%20aaaabbbbccccddddeeeeffff00001111.md).`);
  z.file(`Export-1/Garden ${id}/Seeds aaaabbbbccccddddeeeeffff00001111.md`, '# Seeds\n\nSow tomatoes in March.');
  z.file(`Export-1/Garden ${id}/Plants bbbbccccddddeeeeffff000011112222.csv`, 'Name,Height\nTomato,120\nBasil,40\n');
  const zipPath = test.info().outputPath('notion.zip');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(zipPath, await z.generateAsync({ type: 'uint8array' }));

  await freshApp(page);
  await onboard(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Storage & backups' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import…' }).click();
  await (await chooser).setFiles(zipPath);
  await expect(page.getByText('Imported 2 pages, 1 database and 0 images.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Page title')).toHaveValue('Imported from Notion');
  await page.getByRole('treeitem', { name: /Imported from Notion/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /^.*Garden/ }).click();
  await expect(editor(page).getByRole('link', { name: 'Seeds' })).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search pages, notes, documents, tasks…').fill('tomatoes');
  await expect(page.getByRole('listbox')).toContainText('Seeds');
});

test('quick capture saves a note to the Inbox', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await page.keyboard.press('Control+Shift+Space');
  await page.getByLabel('Title (optional)').fill('Idea');
  await page.getByLabel('Write anything — Markdown works. It goes to your Inbox page.').fill('- call the printer\n- **buy** paper');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByText('Saved to Inbox.')).toBeVisible();
  await page.getByRole('treeitem', { name: /Inbox/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /Idea/ }).click();
  await expect(page.getByLabel('Page title')).toHaveValue('Idea');
  await expect(editor(page)).toContainText('call the printer');
  await expect(editor(page).locator('strong')).toHaveText('buy');
});

test('typing in a dialog keeps focus in the field being typed in', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await page.keyboard.press('Control+Shift+Space');
  const title = page.getByLabel('Title (optional)');
  await expect(title).toBeFocused();
  await page.keyboard.type('Plan', { delay: 40 });
  const body = page.getByLabel('Write anything — Markdown works. It goes to your Inbox page.');
  await body.click();
  await page.keyboard.type('buy milk and bread', { delay: 40 }); // every keystroke re-renders the dialog
  await expect(title).toHaveValue('Plan');
  await expect(body).toHaveValue('buy milk and bread');
  await expect(body).toBeFocused();
});

test('images are read with offline OCR, without an AI provider', async ({ page, browser }) => {
  test.setTimeout(180_000);
  // Render a crisp text image to import.
  const shot = await browser.newPage({ viewport: { width: 900, height: 220 } });
  await shot.setContent('<body style="margin:0;background:#fff"><p style="font:48px Arial;margin:40px">Chlorophyll absorbs sunlight</p></body>');
  const pngPath = test.info().outputPath('ocr.png');
  await shot.screenshot({ path: pngPath });
  await shot.close();

  await freshApp(page);
  await onboard(page);
  await page.getByRole('button', { name: 'Sources' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import files' }).first().click();
  await (await chooser).setFiles(pngPath);
  await expect(page.getByText('Ready').first()).toBeVisible({ timeout: 120_000 });
  await page.getByText('ocr', { exact: true }).click();
  await expect(page.getByLabel('Extracted text')).toContainText(/Chlorophyll absorbs sunlight/i);

  // A "scanned" PDF: the page is only an image, so there is no text layer to extract.
  const { readFileSync } = await import('node:fs');
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(`<img style="width:100%" src="data:image/png;base64,${readFileSync(pngPath).toString('base64')}">`);
  const pdfPath = test.info().outputPath('scan.pdf');
  await pdfPage.pdf({ path: pdfPath, format: 'A4' });
  await pdfPage.close();
  await page.keyboard.press('Escape');
  const chooser2 = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import files' }).first().click();
  await (await chooser2).setFiles(pdfPath);
  await expect(page.getByText('Ready')).toHaveCount(2, { timeout: 120_000 });
  await page.getByText('scan', { exact: true }).click();
  await expect(page.getByLabel('Extracted text')).toContainText(/absorbs sunlight/i);
});

test('database timeline view shows dated rows and persists', async ({ page }) => {
  const db = await freshApp(page);
  await onboard(page, { sample: true });
  await page.getByRole('treeitem', { name: /Projects/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /Reading list/ }).click();
  await page.getByRole('button', { name: 'Add view' }).click();
  await page.getByRole('menuitem', { name: 'Timeline' }).click();
  await expect(page.getByRole('grid', { name: 'Timeline' }).getByRole('gridcell')).toHaveCount(3);
  await page.waitForTimeout(600);
  await page.goto(`/?db=${db}`);
  await page.getByRole('treeitem', { name: /Projects/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /Reading list/ }).click();
  await expect(page.getByRole('tab', { name: /Timeline/ })).toBeVisible();
});

test('two-way relation keeps both sides linked and a rollup sums linked rows', async ({ page }) => {
  await freshApp(page);
  await onboard(page, { sample: true });
  await page.getByRole('treeitem', { name: /Projects/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /Reading list/ }).click();
  const grid = page.getByRole('grid');
  // Self-relation, two-way: adds "Reading list" and its paired back-link column.
  await page.getByRole('button', { name: 'Add property' }).click();
  await page.getByRole('menuitem', { name: 'Relation' }).click();
  await expect(page.getByLabel('Two-way: also show the link in the other database')).toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: /Reading list/ }).click();
  const headers = grid.locator('thead th');
  await expect(headers.filter({ hasText: 'Reading list' })).toHaveCount(2);
  const names = await headers.allInnerTexts();
  const fwd = names.findIndex((n) => n.includes('Reading list'));
  const back = names.findIndex((n, i) => i > fwd && n.includes('Reading list'));
  const row = (title: RegExp) => grid.getByRole('row').filter({ has: page.locator('td:nth-child(2)', { hasText: title }) });
  await row(/Scientific Revolutions/).locator('td').nth(fwd).getByRole('button').first().click();
  await page.locator('button').filter({ has: page.locator('input[type=checkbox]'), hasText: 'Thinking, Fast and Slow' }).click();
  await page.keyboard.press('Escape');
  await expect(row(/Thinking, Fast/).locator('td').nth(back)).toContainText('The Structure of Scientific Revolutions');
  // Rollup: sum of the linked rows' pages.
  await page.getByRole('button', { name: 'Add property' }).click();
  await page.getByRole('menuitem', { name: 'Rollup' }).click();
  await page.getByLabel('Property of the linked rows').selectOption({ label: 'Pages' });
  await page.getByLabel('Calculate').selectOption({ label: 'Sum' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  const rollupCol = (await headers.allInnerTexts()).findIndex((n) => n.includes('Rollup'));
  await expect(row(/Scientific Revolutions/).locator('td').nth(rollupCol)).toHaveText('499');
});

test('a page exports straight to a PDF file', async ({ page }) => {
  await freshApp(page);
  await onboard(page, { sample: true });
  await page.getByRole('treeitem', { name: /Welcome tour/ }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Page menu' }).click();
  await page.getByRole('menuitem', { name: 'Export as PDF' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = await (await import('node:fs/promises')).readFile((await file.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(5_000); // embedded (subset) font + content
});

test('export everything and import it on another computer', async ({ page }) => {
  await freshApp(page);
  await onboard(page, { sample: true });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Storage & backups' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all…' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^Noesis .+\.zip$/);
  const zipPath = test.info().outputPath('export.zip');
  await file.saveAs(zipPath);
  await expect(page.getByText(/Exported \d+ pages, 1 database/)).toBeVisible();

  // "Another computer": a brand-new, empty workspace database.
  await freshApp(page, 'second computer');
  await onboard(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Storage & backups' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import…' }).click();
  await (await chooser).setFiles(zipPath);
  await expect(page.getByText(/Also restored 3 tasks and 1 source/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('treeitem', { name: /Imported from Noesis/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /Welcome tour/ }).click();
  await expect(editor(page)).toContainText('Your notes are stored only on this computer.');
  await page.getByRole('treeitem', { name: /Projects/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /Reading list/ }).click();
  await expect(page.getByText('Thinking, Fast and Slow')).toBeVisible();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.getByText('Finish literature review')).toBeVisible();
});

test('settings: editor font, spacing, week start, interface size, start page and reset', async ({ page }) => {
  const db = await freshApp(page);
  await onboard(page, { sample: true });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Open on start' })).toBeVisible(); // General is the first section

  await page.getByRole('radiogroup', { name: 'Week starts on' }).getByRole('radio', { name: 'Sunday' }).click();
  await page.getByRole('radiogroup', { name: 'Open on start' }).getByRole('radio', { name: 'Last opened page' }).click();

  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Editor font' }).getByRole('radio', { name: 'Monospace' }).click();
  await page.getByRole('radiogroup', { name: 'Line spacing' }).getByRole('radio', { name: 'Relaxed' }).click();
  await page.getByLabel('Editor text size').fill('20');

  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Interface size' }).getByRole('radio', { name: '110%' }).click();
  await expect(page.locator('html')).toHaveCSS('font-size', '17.6px');

  // The editor uses the chosen font, size and spacing.
  await page.getByRole('treeitem', { name: /Welcome tour/ }).click();
  const ed = editor(page);
  await expect(ed).toHaveCSS('font-size', '20px');
  await expect(ed).toHaveCSS('line-height', '39px');
  expect(await ed.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Cascadia|monospace/);

  // Calendar weeks start on Sunday.
  await page.getByRole('treeitem', { name: /Projects/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /Reading list/ }).click();
  await page.getByRole('tab', { name: /Calendar/ }).click();
  await expect(page.getByText('Sun', { exact: true }).first()).toBeVisible();
  const firstHeader = await page.locator('text=/^(Sun|Mon)$/').first().textContent();
  expect(firstHeader).toBe('Sun');

  // "Last opened page" reopens the Reading list after a restart.
  await page.waitForTimeout(400);
  await page.goto(`/?db=${db}`);
  await expect(page.getByRole('tab', { name: /Calendar/ })).toBeVisible();

  // Reset brings the defaults back.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Reset settings' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /OK|Confirm|Reset/ }).last().click();
  await expect(page.getByText('Settings reset.')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Week starts on' }).getByRole('radio', { name: 'Monday' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveCSS('font-size', '16px');
});

test('pages written by AI clients through MCP appear with their agent and repositories in the graph', async ({ page }) => {
  await freshApp(page);
  await onboard(page);
  await page.evaluate(async () => {
    const state = (window as unknown as { __noesis: { getState(): { repos: Repos; workspaceId: string } } }).__noesis.getState();
    const { handleMcp } = await import(/* @vite-ignore */ '/src/mcp/server.ts');
    const ctx = { repos: state.repos, workspaceId: state.workspaceId, client: 'Codex', approve: async () => true, notify: () => {} };
    for (const title of ['Agent note A', 'Agent note B'])
      await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_page', arguments: { title, markdown: 'See https://github.com/rojo-rbx/rojo' } } }, ctx);
    await state.repos.db.flushNow();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Knowledge Graph' }).click();
  await expect(page.getByRole('button', { name: 'AI agents' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Repositories' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Find a node…').fill('Codex');
  await page.getByLabel('Find a node…').press('Enter');
  const panel = page.locator('aside');
  await expect(panel.getByText('🤖 Codex')).toBeVisible();
  await expect(panel.getByText('2 connections')).toBeVisible();
  await expect(panel.getByRole('button', { name: /wrote · Agent note A/ })).toBeVisible();
  await panel.getByRole('button', { name: /Agent note A/ }).click();
  await expect(panel.getByRole('button', { name: /mentions · rojo-rbx\/rojo/ })).toBeVisible();
});
