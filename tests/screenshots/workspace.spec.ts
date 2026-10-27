import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Real application screens with built-in sample data; no fake AI answers or keys.
test('capture the English sample workspace for the README', async ({ page }) => {
  const directory = resolve('docs/images');
  await mkdir(directory, { recursive: true });
  await page.goto(`/?db=readme-${Date.now()}`);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Name your workspace').fill('My Knowledge Space');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Add sample content' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  await page.getByRole('treeitem', { name: /Welcome tour/ }).click();
  await expect(page.getByLabel('Page content')).toContainText('Your notes are stored only on this computer.');
  await page.screenshot({ path: resolve(directory, 'editor.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'AI Notebooks', exact: true }).click();
  await page.getByRole('button', { name: /Beekeeping research/ }).click();
  await expect(page.getByLabel('Use The Honeybee Colony — field primer')).toBeEnabled();
  await page.screenshot({ path: resolve(directory, 'research.png'), animations: 'disabled' });
  await page.getByRole('treeitem', { name: /Projects/ }).getByRole('button', { name: 'Expand' }).click();
  await page.getByRole('treeitem', { name: /Reading list/ }).click();
  await page.getByRole('tab', { name: /Board/ }).click();
  await expect(page.getByText('The Structure of Scientific Revolutions')).toBeVisible();
  await page.screenshot({ path: resolve(directory, 'database.png'), animations: 'disabled' });
  await page.keyboard.press('Control+Shift+l');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: resolve(directory, 'dark-mode.png'), animations: 'disabled' });
});
