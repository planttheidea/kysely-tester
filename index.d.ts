import { Kysely, KyselyPlugin, TableMetadata } from 'kysely';
import { PGlite } from '@electric-sql/pglite';

interface CustomMatchers<Result = unknown> {
    toHaveColumns(expected: Record<string, string>): Result;
}
declare module 'vitest' {
    interface Matchers<T = any> extends CustomMatchers<T> {
    }
}
/**
 * Registers the package's custom matchers with vitest's `expect`.
 *
 * Call it from a `setupFiles` module, or name `@planttheidea/kysely-tester/setup`
 * there directly and skip writing one.
 */
declare function extendExpect(): void;

type AnyKysely = Kysely<any>;

declare function getTable(db: AnyKysely, tableName: string): Promise<TableMetadata | undefined>;
declare function getTables<const Names extends string[] | readonly string[]>(db: AnyKysely, tableNames: Names): Promise<Record<Names[number], TableMetadata | undefined>>;

/**
 * How far through the migration list a leased instance should be brought:
 * a step name to stop after, `null` for a bare instance with no migration
 * applied, and `undefined` for the whole list.
 */
type MigrationState = string | null | undefined;
interface PglitePoolConfig {
    /** Builds one pooled pglite instance. Called `size` times while the pool starts. */
    createInstance: () => Promise<PGlite>;
    /** Wraps a pooled instance for the establish/wipe hooks, plugins included. */
    createQueryBuilder: (instance: PGlite) => AnyKysely;
    /** Brings a bare instance to the requested migration state. */
    establish: (db: AnyKysely, state: MigrationState) => Promise<void>;
    /**
     * How many pglite instances stay live, and so the ceiling on how many tests
     * can hold a database at once. Every other test runs unthrottled.
     */
    size?: number;
    /** Strips an instance back to bare, ready for `establish` to run again. */
    wipe: (db: AnyKysely) => Promise<void>;
}

interface PooledPgliteOptions {
    plugins?: KyselyPlugin[];
    /** How far to migrate the leased instance. Defaults to the whole migration list. */
    state?: MigrationState;
}
/**
 * Builds a database that will take a lease, without waiting for one.
 *
 * Splitting this from the wait is what lets a caller register its teardown
 * before blocking: a test that times out while its lease is still queued has
 * already abandoned the promise, and without a registered `destroy` the lease
 * arrives later with nobody to hand it back — which retires an instance for the
 * rest of the run and times out everything queued behind it.
 */
declare function createPooledPglite<Schema>(options?: PooledPgliteOptions): Kysely<Schema>;
/**
 * Waits for the lease `createPooledPglite` asked for.
 *
 * Taking a connection through Kysely afterwards looks redundant — the lease is
 * already held — but it is what makes `destroy` work. Kysely only marks its
 * driver initialized on the first connection it hands out, and only a driver it
 * considers initialized is one it will destroy. A test that leases a database
 * and never queries it would otherwise hold the instance until its worker
 * process exited, and the run would stall on whichever test asked next.
 */
declare function connectPooledPglite(db: AnyKysely): Promise<void>;
/**
 * Leases one pglite instance from the pool the vitest global setup started,
 * already migrated to the requested state.
 *
 * Boot and migration were paid once at startup rather than once per test, so
 * for the default state this is a socket connect and nothing more.
 */
declare function getPooledPglite<Schema>(options?: PooledPgliteOptions): Promise<Kysely<Schema>>;
/**
 * Throws away everything the current test wrote and hands the same lease back
 * at the state it was leased at.
 */
declare function resetPooledPglite(db: AnyKysely): Promise<void>;

interface PglitePoolGlobalSetupOptions {
    /** Name of the `PglitePoolConfig` export to read out of `configPath`. */
    configExport: string;
    /**
     * Absolute path to the module holding the pglite pool config. Resolve it in the
     * calling package — `createRequire(import.meta.url).resolve(...)` — so a
     * missing dependency fails here rather than inside the pool process.
     */
    configPath: string;
    /** Overrides the config's own `size`, for a package that needs a smaller pool. */
    size?: number;
}
interface PglitePoolGlobalSetup {
    setup: () => Promise<void>;
    teardown: () => Promise<void>;
}
/**
 * Builds the `setup`/`teardown` pair a vitest `globalSetup` module exports.
 *
 * The pool runs in a forked process, and its socket path reaches the workers
 * through the environment — the database package reads it from code that must
 * not import vitest, so `provide`/`inject` is not open to it.
 */
declare function createPglitePoolGlobalSetup(options: PglitePoolGlobalSetupOptions): PglitePoolGlobalSetup;

/**
 * Strips a pglite instance back to bare, so a pool config's `establish` can run
 * against it as if the instance had just booted.
 *
 * Drops schemas rather than tables because a migration list creates views,
 * triggers, functions and extensions too, and a test that reached the point of
 * needing this wants none of them.
 */
declare function wipePglite(db: AnyKysely): Promise<void>;

type Migrations<Config extends FactoryConfig> = Config['migrationOrder'][number] | null;
interface FactoryConfig {
    migrationOrder: string[] | readonly string[];
    migrations: Record<string, string>;
    establishBaseState?: (db: AnyKysely) => Promise<void>;
}
interface Options<MigrationState> {
    migrationState?: MigrationState;
}
interface MockSqliteDatabaseFactory<Config extends FactoryConfig> {
    createBareDatabase: () => AnyKysely;
    createMockDatabase: (options?: Options<Migrations<Config>>) => Promise<AnyKysely>;
    restoreMockDatabase: (db: AnyKysely, options?: Options<Migrations<Config>>) => Promise<void>;
    wipeMockDatabase: (db: AnyKysely) => Promise<void>;
}

declare function createMockSqliteDatabaseFactory<const Config extends FactoryConfig>(config: Config): MockSqliteDatabaseFactory<Config>;

export { connectPooledPglite, createMockSqliteDatabaseFactory, createPglitePoolGlobalSetup, createPooledPglite, extendExpect, getPooledPglite, getTable, getTables, resetPooledPglite, wipePglite };
export type { AnyKysely, FactoryConfig, MigrationState, MockSqliteDatabaseFactory, Options, PglitePoolConfig, PglitePoolGlobalSetup, PglitePoolGlobalSetupOptions, PooledPgliteOptions };
