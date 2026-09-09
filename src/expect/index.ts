import { expect } from 'vitest';
import { toHaveColumns } from './toHaveColumns.js';

interface CustomMatchers<Result = unknown> {
  /**
   * Asserts a table's columns against their data types, with column names
   * camel-cased and types named the way the dialect reports them.
   *
   * Exhaustive by default — every column has to appear. Wrap `expected` in
   * `expect.objectContaining` to assert only some of them. A table that was
   * never created fails saying so, rather than on a missing property.
   *
   * ```ts
   * expect(await getTable(db, 'widget')).toHaveColumns({
   *   id: 'int4',
   *   createdAt: 'timestamptz',
   * });
   * ```
   */
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
