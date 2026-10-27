import { defineConfig } from '@playwright/test';
import config from './playwright.config';
export default defineConfig({ ...config, testDir: 'tests/screenshots', reporter: 'list', use: { ...config.use, viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' } });
