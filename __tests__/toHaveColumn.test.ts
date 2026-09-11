import type { TableMetadata } from 'kysely';

const widget = {
  columns: [
    { dataType: 'uuid', name: 'id' },
    { dataType: 'timestamptz', name: 'created_at' },
  ],
  name: 'widget',
} as TableMetadata;

describe('toHaveColumn', () => {
  test('passes when the column is present', () => {
    expect(widget).toHaveColumn('id');
  });

  test('passes when the column is present with the expected data type', () => {
    expect(widget).toHaveColumn('id', 'uuid');
  });

  test('matches a column by the camel-cased name a test reads', () => {
    expect(widget).toHaveColumn('createdAt', 'timestamptz');
  });

  test('passes when negated and the column is absent', () => {
    expect(widget).not.toHaveColumn('retiredAt');
  });

  test('fails when the column is absent', () => {
    expect(() => expect(widget).toHaveColumn('retiredAt')).toThrow(
      /Expected "widget" to have a column named "retiredAt"/,
    );
  });

  test('fails when the data type does not match', () => {
    expect(() => expect(widget).toHaveColumn('id', 'text')).toThrow(
      /Expected "widget" column "id" to be of type "text", but it was "uuid"/,
    );
  });

  test('fails when passed undefined', () => {
    expect(() => {
      expect(undefined).toHaveColumn('id');
    }).toThrowErrorMatchingInlineSnapshot('[Error: Did not receive a table. Has it been added to the schema yet?]');
  });
});
