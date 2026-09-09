import type { TableMetadata } from 'kysely';

describe('toHaveColumns', () => {
  test('passes when valid', () => {
    const mockTable = {
      columns: [{ dataType: 'uuid', name: 'id' }],
      name: 'test',
    } as TableMetadata;

    expect(mockTable).toHaveColumns({ id: 'uuid' });
  });

  test('passes when valid with partials', () => {
    const mockTable = {
      columns: [
        { dataType: 'uuid', name: 'id' },
        { dataType: 'text', name: 'name' },
      ],
      name: 'test',
    } as TableMetadata;

    expect(mockTable).toHaveColumns(expect.objectContaining({ name: 'text' }) as Record<string, string>);
  });

  test('fails when passed undefined', () => {
    expect(() => {
      expect(undefined).toHaveColumns({ test: 'id' });
    }).toThrowErrorMatchingInlineSnapshot('[Error: Did not receive a table. Has it been added to the schema yet?]');
  });

  test('fails when data types do not match', () => {
    const mockTable = {
      columns: [{ dataType: 'text', name: 'id' }],
      name: 'test',
    } as TableMetadata;

    expect(() => expect(mockTable).toHaveColumns({ id: 'uuid' })).toThrow(/Expected column data types for "test"/);
  });
});
