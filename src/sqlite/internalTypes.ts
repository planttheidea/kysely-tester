import type { AnyKysely } from '../types.js';

type Migrations<Config extends FactoryConfig> = Config['migrationOrder'][number] | null;

export interface FactoryConfig {
  migrationOrder: string[] | readonly string[];
  migrations: Record<string, string>;
  establishBaseState?: (db: AnyKysely) => Promise<void>;
}

export interface Options<MigrationState> {
  migrationState?: MigrationState;
}

export interface MockSqliteDatabaseFactory<Config extends FactoryConfig> {
  createBareDatabase: () => AnyKysely;
  createMockDatabase: (options?: Options<Migrations<Config>>) => Promise<AnyKysely>;
  restoreMockDatabase: (db: AnyKysely, options?: Options<Migrations<Config>>) => Promise<void>;
  wipeMockDatabase: (db: AnyKysely) => Promise<void>;
}
