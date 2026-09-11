import type { AnyKysely } from '../types.js';

type Migrations<Config extends FactoryConfig> = Config['migrationOrder'][number] | null;

export interface FactoryConfig {
  /** Migration names, in the order they should run. */
  migrationOrder: string[] | readonly string[];
  /**
   * Each migration name mapped to the absolute path of the module that owns it.
   * The module is imported by path and expected to export `up`.
   */
  migrations: Record<string, string>;
  /**
   * Anything the schema assumes but no migration creates — a table another
   * system provisions, a seeded row a foreign key points at. Runs against a
   * bare database before the first migration, whatever state is asked for.
   */
  establishBaseState?: (db: AnyKysely) => Promise<void>;
}

export interface Options<MigrationState> {
  /**
   * How far to migrate: a step name to stop after, or `null` for a bare
   * database with no migration applied. Defaults to the last step in
   * `migrationOrder`.
   */
  migrationState?: MigrationState;
}

export interface MockSqliteDatabaseFactory<Config extends FactoryConfig> {
  /** An empty in-memory database, with neither base state nor migrations. */
  createBareDatabase: () => AnyKysely;
  /** A new in-memory database, migrated to the requested state. */
  createMockDatabase: (options?: Options<Migrations<Config>>) => Promise<AnyKysely>;
  /** Wipes an existing handle and rebuilds it at the requested state. */
  restoreMockDatabase: (db: AnyKysely, options?: Options<Migrations<Config>>) => Promise<void>;
  /** Strips an existing handle back to bare, dropping everything in it. */
  wipeMockDatabase: (db: AnyKysely) => Promise<void>;
}
