import { expect } from 'vitest';
import { createToHaveColumn } from './toHaveColumn.js';
import { createToHaveColumns } from './toHaveColumns.js';

export interface ExtendExpectOptions {
  /**
   * Whether a column's name is camel-cased before it is compared, matching a
   * Kysely instance that carries `CamelCasePlugin`. Defaults to `true`.
   *
   * Turn it off for a schema whose columns are camel-cased in the database
   * itself, or one that mixes the two — `neon_auth.project_config` alongside
   * `app.event` — where the dialect's own spelling is the only one that names
   * every column.
   */
  camelCase?: boolean;
}

interface CustomMatchers<Result = unknown> {
  /**
   * Asserts a table has a single named column, optionally of a given data type.
   *
   * Negate with `.not` to assert absence, and pass only the name when you do:
   * `.not.toHaveColumn(name, type)` reads as "no column of that type", so a
   * same-named column that changed type would still satisfy it.
   *
   * ```ts
   * expect(await getTable(db, 'widget')).not.toHaveColumn('retiredAt');
   * ```
   */
  toHaveColumn(name: string, dataType?: string): Result;
  /**
   * Asserts a table's columns against their data types, with types named the
   * way the dialect reports them and column names spelled per the `camelCase`
   * option `extendExpect` was given.
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
 * there directly and skip writing one — that entry is this call with its
 * defaults.
 */
export function extendExpect({ camelCase = true }: ExtendExpectOptions = {}): void {
  expect.extend({
    toHaveColumn: createToHaveColumn(camelCase),
    toHaveColumns: createToHaveColumns(camelCase),
  });
}
