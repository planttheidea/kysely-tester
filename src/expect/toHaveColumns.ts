import type { TableMetadata } from 'kysely';
import type { MatcherState } from 'vitest';

function toCamelCase(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

/**
 * `received` is typed as possibly missing because a matcher runs against
 * whatever the test hands it, and the whole point of the first branch is the
 * table that introspection did not find.
 */
export function toHaveColumns(
  this: MatcherState,
  received: TableMetadata | undefined,
  expected: Record<string, string>,
) {
  if (!received) {
    return {
      message: () => 'Did not receive a table. Has it been added to the schema yet?',
      pass: false,
    };
  }

  const columns = received.columns.reduce<Record<string, string>>((agg, { dataType, name }) => {
    agg[toCamelCase(name)] = dataType;

    return agg;
  }, {});

  if (this.equals(columns, expected)) {
    return { message: () => '', pass: true };
  }

  const diff = this.utils.diff(expected, columns);
  const negation = this.isNot ? ' not' : '';

  return {
    message: () => `Expected column data types for "${received.name}"${negation} to be equal:\n\n${String(diff)}`,
    pass: false,
  };
}
