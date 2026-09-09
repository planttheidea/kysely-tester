import { defineConfig } from 'vitest/config';

/**
 * Kept apart from the unit config because these tests install a package into a
 * temporary project, which costs far too much to sit in the loop a change is
 * made against. `release:scripts` runs them; `npm test` does not.
 */
export default defineConfig({
  test: {
    exclude: ['**/__helpers__/**', '**/node_modules/**'],
    globals: true,
    hookTimeout: 300_000,
    include: ['**/__integration__/**/*.test.ts'],
    testTimeout: 300_000,
    // One temporary project, installed once, is enough — and parallel `yarn
    // install` runs against the same cache only slow each other down.
    fileParallelism: false,
  },
});
