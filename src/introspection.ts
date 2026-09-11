import type { TableMetadata } from 'kysely';
import { getMatches, matchesSchemedName } from './schemedName.js';
import type { AnyKysely } from './types.js';

/**
 * The metadata a dialect reports for one table, or `undefined` when nothing by
 * that name exists.
 *
 * `tableName` is matched schema-qualified when it carries a `.` — `app.event` —
 * and on the table name alone when it does not, so a workspace that only ever
 * uses `public` never has to write the prefix.
 *
 * ```ts
 * expect(await getTable(db, 'widget')).toHaveColumns({ id: 'uuid' });
 * ```
 */
export async function getTable(db: AnyKysely, tableName: string): Promise<TableMetadata | undefined> {
  const all = await db.introspection.getTables();

  return all.find((table) => matchesSchemedName(table, tableName));
}

/**
 * The metadata for several tables in one introspection pass, keyed by the names
 * that were asked for — so a name that matched nothing is present and
 * `undefined` rather than absent, and a caller can assert on it directly.
 *
 * Names are matched the way {@link getTable} matches them.
 *
 * ```ts
 * const tables = await getTables(db, ['app.event', 'app.attendee']);
 *
 * expect(tables['app.event']).toHaveColumns({ id: 'uuid' });
 * ```
 */
export async function getTables<const Names extends string[] | readonly string[]>(
  db: AnyKysely,
  tableNames: Names,
): Promise<Record<Names[number], TableMetadata | undefined>> {
  const all = await db.introspection.getTables();

  return getMatches(all, tableNames);
}
