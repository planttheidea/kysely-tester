import type { PgliteInstance } from './internalTypes.js';

const SETTING = 'pglite_pool.schema_changed';
const FUNCTION = 'public.pglite_pool_record_schema_change';
const COMMAND_END_TRIGGER = 'pglite_pool_schema_change_end';
const SQL_DROP_TRIGGER = 'pglite_pool_schema_change_drop';

const STATUS_QUERY = `
  SELECT
    coalesce(current_setting('${SETTING}', true), '1') = '1' AS changed,
    (
      SELECT count(*) = 2 FROM pg_catalog.pg_event_trigger
      WHERE evtname IN ('${COMMAND_END_TRIGGER}', '${SQL_DROP_TRIGGER}') AND evtenabled <> 'D'
    ) AS armed
`;

export interface SchemaChangeStatus {
  /** Whether both event triggers are still in place and enabled. */
  armed: boolean;
  /** Whether any DDL has run since the detector was last created. */
  changed: boolean;
}

/**
 * Arms an instance to report, in one cheap read, whether a test ran any DDL.
 *
 * Postgres decides what counts as DDL here, which is the whole point: a
 * fingerprint over the catalog only catches the kinds of object somebody
 * thought to enumerate, and the migration-step tests are precisely the ones
 * that reach for the kind nobody listed. An event trigger fires on all of it —
 * a column added, a view redefined, a trigger hung off a table that already
 * existed — none of which moves the table list a cheaper check would read.
 *
 * The flag is a session setting rather than a row, so no bookkeeping table
 * shows up in a consumer's introspection, and a `TRUNCATE` cannot clear it.
 * Setting it non-locally also makes it transactional in the way that matters:
 * DDL rolled back takes its own flag with it.
 */
export async function createSchemaChangeDetector(instance: PgliteInstance): Promise<void> {
  await instance.query(`
    CREATE OR REPLACE FUNCTION ${FUNCTION}() RETURNS event_trigger AS $$
      BEGIN PERFORM set_config('${SETTING}', '1', false); END;
    $$ LANGUAGE plpgsql
  `);
  await instance.query(`DROP EVENT TRIGGER IF EXISTS ${COMMAND_END_TRIGGER}`);
  await instance.query(`CREATE EVENT TRIGGER ${COMMAND_END_TRIGGER} ON ddl_command_end EXECUTE FUNCTION ${FUNCTION}()`);
  await instance.query(`DROP EVENT TRIGGER IF EXISTS ${SQL_DROP_TRIGGER}`);
  await instance.query(`CREATE EVENT TRIGGER ${SQL_DROP_TRIGGER} ON sql_drop EXECUTE FUNCTION ${FUNCTION}()`);
  await instance.query(`SELECT set_config('${SETTING}', '0', false)`);
}

/**
 * Reads whether DDL has run, and whether the detector is still watching.
 *
 * `armed` is what keeps the flag from being trusted blindly. A test that drops
 * the schema the detector's function lives in takes the detector with it, and
 * an unarmed instance that reports no change is exactly the stale database this
 * whole mechanism exists to catch — so an unarmed reading means "rebuild",
 * never "clean".
 */
export async function getSchemaChangeStatus(instance: PgliteInstance): Promise<SchemaChangeStatus> {
  const { rows } = await instance.query<SchemaChangeStatus>(STATUS_QUERY);

  return rows[0] ?? { armed: false, changed: true };
}
