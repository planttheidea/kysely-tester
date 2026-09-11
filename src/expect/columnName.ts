/**
 * A column's name as an assertion spells it.
 *
 * `camelCase` mirrors whether the Kysely instance under test carries
 * `CamelCasePlugin`: with it, a test reads `createdAt` off a `created_at`
 * column and expects to assert the name it read. Without it the dialect's own
 * spelling is the only one the test ever sees, and rewriting it here would make
 * a column the schema really does call `created_at` unassertable.
 */
export function getColumnName(name: string, camelCase: boolean): string {
  return camelCase ? name.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase()) : name;
}
