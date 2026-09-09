import { sql } from 'kysely';
import type { AnyKysely } from '../types.js';

/**
 * Strips a pglite instance back to bare, so a pool config's `establish` can run
 * against it as if the instance had just booted.
 *
 * Drops schemas rather than tables because a migration list creates views,
 * triggers, functions and extensions too, and a test that reached the point of
 * needing this wants none of them.
 */
export async function wipePglite(db: AnyKysely): Promise<void> {
  // `IF EXISTS` because a test that dropped `public` itself must still be
  // recoverable — without it the wipe throws and the instance never comes back.
  await sql.raw('DROP SCHEMA IF EXISTS public CASCADE;').execute(db);
  await sql.raw('CREATE SCHEMA public;').execute(db);

  const { rows: schemas } = await sql<{ schemaName: string }>`
    SELECT schema_name AS "schemaName" FROM information_schema.schemata
    WHERE schema_name NOT IN ('public', 'pg_catalog', 'information_schema')
      AND schema_name NOT LIKE 'pg\\_%'
  `.execute(db);

  for (const { schemaName } of schemas) {
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
  }

  const { rows: extensions } = await sql<{ extname: string }>`
    SELECT extname FROM pg_catalog.pg_extension WHERE extname != 'plpgsql'
  `.execute(db);

  for (const { extname } of extensions) {
    await sql.raw(`DROP EXTENSION IF EXISTS "${extname}" CASCADE`).execute(db);
  }
}
