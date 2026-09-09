import type { TableMetadata } from 'kysely';
import type { AnyKysely } from './types.js';

export async function getTable(db: AnyKysely, tableName: string): Promise<TableMetadata | undefined> {
  const all = await db.introspection.getTables();

  return all.find((t) => t.name === tableName);
}

export async function getTables<const Names extends string[] | readonly string[]>(
  db: AnyKysely,
  tableNames: Names,
): Promise<Record<Names[number], TableMetadata | undefined>> {
  const requested = new Set<string>(tableNames);
  const all = await db.introspection.getTables();

  return all.reduce<Record<string, TableMetadata | undefined>>(
    (acc, table) => {
      if (requested.has(table.name)) {
        acc[table.name] = table;
      }

      return acc;
    },
    Object.fromEntries(tableNames.map((n) => [n, undefined])),
  );
}
