import SqLite from 'better-sqlite3';
import { CamelCasePlugin, Kysely, SqliteDialect, sql } from 'kysely';
import { registerTypeScriptResolution } from '../typeScriptResolution.js';
import type { FactoryConfig, MockSqliteDatabaseFactory, Options } from './internalTypes.js';

export function createMockSqliteDatabaseFactory<const Config extends FactoryConfig>(
  config: Config,
): MockSqliteDatabaseFactory<Config> {
  type Migrations = Config['migrations'];
  type MigrationState = keyof Migrations | null;

  const defaultMigrationState = config.migrationOrder.at(-1) ?? null;

  // The migration modules below are imported by path, which reaches Node
  // directly rather than the test runner's resolver.
  registerTypeScriptResolution();

  function createBareDatabase(): Kysely<unknown> {
    return new Kysely({
      dialect: new SqliteDialect({
        database: new SqLite(':memory:'),
      }),
      plugins: [new CamelCasePlugin()],
    });
  }

  async function createMockDatabase(
    options: Options<MigrationState> = { migrationState: defaultMigrationState },
  ): Promise<Kysely<unknown>> {
    const db = createBareDatabase();

    await sql`PRAGMA foreign_keys = ON`.execute(db);
    await establishMockDatabase(db, options);

    return db;
  }

  async function establishMockDatabase(
    db: Kysely<unknown>,
    { migrationState = defaultMigrationState }: Options<MigrationState>,
  ): Promise<void> {
    await config.establishBaseState?.(db);

    if (migrationState === null) {
      return;
    }

    for (const step of config.migrationOrder) {
      const migrationFile = config.migrations[step];

      if (!migrationFile) {
        throw new Error(`"${step}" is in the migration order but has no migration file.`);
      }

      const { up } = (await import(migrationFile)) as {
        up: (db: Kysely<unknown>) => Promise<void>;
      };

      await up(db);

      if (step === migrationState) {
        break;
      }
    }
  }

  async function restoreMockDatabase(
    db: Kysely<unknown>,
    options: Options<MigrationState> = { migrationState: defaultMigrationState },
  ): Promise<void> {
    await wipeMockDatabase(db);
    await sql`PRAGMA foreign_keys = ON`.execute(db);
    await establishMockDatabase(db, options);
  }

  async function wipeMockDatabase(db: Kysely<unknown>): Promise<void> {
    await sql`PRAGMA foreign_keys = OFF`.execute(db);

    const { rows: triggers } = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'trigger'
  `.execute(db);

    for (const { name } of triggers) {
      await sql.raw(`DROP TRIGGER IF EXISTS "${name}"`).execute(db);
    }

    const { rows: views } = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'view'
  `.execute(db);

    for (const { name } of views) {
      await sql.raw(`DROP VIEW IF EXISTS "${name}"`).execute(db);
    }

    const { rows: tables } = await sql<{ name: string }>`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE 'kysely_%'
  `.execute(db);

    for (const { name } of tables) {
      await sql.raw(`DROP TABLE IF EXISTS "${name}"`).execute(db);
    }
  }

  return {
    createBareDatabase,
    createMockDatabase,
    restoreMockDatabase,
    wipeMockDatabase,
  };
}
