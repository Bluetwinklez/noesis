import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  await expect(editor(page).locator('strong')).toHaveText('buy');
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
