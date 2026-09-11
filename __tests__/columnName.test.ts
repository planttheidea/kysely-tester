import { getColumnName } from '../src/expect/columnName.js';

describe('getColumnName', () => {
  test('camel-cases a snake_case name when asked to', () => {
    expect(getColumnName('created_at', true)).toBe('createdAt');
  });

  test('leaves an already camel-cased name alone', () => {
    expect(getColumnName('createdAt', true)).toBe('createdAt');
  });

  test('leaves a snake_case name alone when not asked to', () => {
    expect(getColumnName('created_at', false)).toBe('created_at');
  });
});
