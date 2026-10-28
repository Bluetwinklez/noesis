import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/eval/**/*.eval.test.ts'], testTimeout: 120_000, fileParallelism: false },
});
