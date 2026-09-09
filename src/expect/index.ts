import { expect } from 'vitest';
import { toHaveColumns } from './toHaveColumns.js';

interface CustomMatchers<Result = unknown> {
  toHaveColumns(expected: Record<string, string>): Result;
}

declare module 'vitest' {
  // biome-ignore lint/suspicious/noExplicitAny: Matches the variance vitest declares.
  interface Matchers<T = any> extends CustomMatchers<T> {}
}

/**
 * Registers the package's custom matchers with vitest's `expect`.
 *
 * Call it from a `setupFiles` module, or name `@planttheidea/kysely-tester/setup`
 * there directly and skip writing one.
 */
export function extendExpect(): void {
  expect.extend({
    toHaveColumns,
  });
}
