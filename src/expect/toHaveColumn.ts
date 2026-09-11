import type { TableMetadata } from 'kysely';
import type { MatcherState } from 'vitest';
import { getColumnName } from './columnName.js';

/**
 * The single-column counterpart to `toHaveColumns`, for the assertion that one
 * column is there — or, negated, that it is gone.
 */
export function createToHaveColumn(camelCase: boolean) {
  return function toHaveColumn(
    this: MatcherState,
    received: TableMetadata | undefined,
    name: string,
    dataType?: string,
  ) {
    if (!received) {
      return {
        message: () => 'Did not receive a table. Has it been added to the schema yet?',
        pass: false,
      };
    }

    const negation = this.isNot ? ' not' : '';
    const column = received.columns.find((candidate) => getColumnName(candidate.name, camelCase) === name);

    if (!column) {
      return {
        message: () => `Expected "${received.name}"${negation} to have a column named "${name}", but it was not found.`,
        pass: false,
      };
    }

    if (dataType !== undefined && column.dataType !== dataType) {
      return {
        message: () =>
          `Expected "${received.name}" column "${name}"${negation} to be of type "${dataType}", but it was "${column.dataType}".`,
        pass: false,
      };
    }

    const typeDetail = dataType === undefined ? '' : ` of type "${dataType}"`;

    return {
      message: () => `Expected "${received.name}"${negation} to have column "${name}"${typeDetail}.`,
      pass: true,
    };
  };
}
