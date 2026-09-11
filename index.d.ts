import { Kysely, KyselyPlugin, TableMetadata } from 'kysely';

interface ExtendExpectOptions {
    /**
     * Whether a column's name is camel-cased before it is compared, matching a
     * Kysely instance that carries `CamelCasePlugin`. Defaults to `true`.
     *
     * Turn it off for a schema whose columns are camel-cased in the database
     * itself, or one that mixes the two — `neon_auth.project_config` alongside
     * `app.event` — where the dialect's own spelling is the only one that names
     * every column.
     */
    camelCase?: boolean;
}
interface CustomMatchers<Result = unknown> {
    /**
     * Asserts a table has a single named column, optionally of a given data type.
     *
     * Negate with `.not` to assert absence, and pass only the name when you do:
     * `.not.toHaveColumn(name, type)` reads as "no column of that type", so a
     * same-named column that changed type would still satisfy it.
     *
     * ```ts
     * expect(await getTable(db, 'widget')).not.toHaveColumn('retiredAt');
     * ```
     */
    toHaveColumn(name: string, dataType?: string): Result;
    /**
     * Asserts a table's columns against their data types, with types named the
     * way the dialect reports them and column names spelled per the `camelCase`
     * option `extendExpect` was given.
     *
     * Exhaustive by default — every column has to appear. Wrap `expected` in
     * `expect.objectContaining` to assert only some of them. A table that was
     * never created fails saying so, rather than on a missing property.
     *
     * ```ts
     * expect(await getTable(db, 'widget')).toHaveColumns({
     *   id: 'int4',
     *   createdAt: 'timestamptz',
     * });
     * ```
     */
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
 * there directly and skip writing one — that entry is this call with its
 * defaults.
 */
declare function extendExpect({ camelCase }?: ExtendExpectOptions): void;

type AnyKysely = Kysely<any>;

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
declare function getTable(db: AnyKysely, tableName: string): Promise<TableMetadata | undefined>;
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
declare function getTables<const Names extends string[] | readonly string[]>(db: AnyKysely, tableNames: Names): Promise<Record<Names[number], TableMetadata | undefined>>;

/**
 * How far through the migration list a leased instance should be brought:
 * a step name to stop after, `null` for a bare instance with no migration
 * applied, and `undefined` for the whole list.
 */
type MigrationState = string | null | undefined;
/**
 * The whole of a pglite instance this package touches.
 *
 * Deliberately structural rather than `PGlite` itself, so nothing shipped here
 * names `@electric-sql/pglite` in its types. A driver that is an optional peer
 * has to be optional to the typechecker too: a consumer who uses only the sqlite
 * factory and runs with `skipLibCheck` off would otherwise get `TS2307` out of
 * this package's own declarations, for a package they were told they could skip.
 *
 * The pool brokers instances it never has to understand — it hands each one back
 * to `createQueryBuilder`, and asks it only for the bookkeeping queries the reset
 * protocol runs — so the narrow shape costs nothing and a real `PGlite` satisfies
 * it. Name the concrete type as `PglitePoolConfig<PGlite>` to get it back.
 */
interface PgliteInstance {
    query: <Row>(query: string, params?: unknown[], options?: {
        rowMode?: 'array' | 'object';
    }) => Promise<{
        affectedRows?: number;
        rows: Row[];
    }>;
}
interface PglitePoolConfig<Instance extends PgliteInstance = PgliteInstance> {
    /** Builds one pooled pglite instance. Called `size` times while the pool starts. */
    createInstance: () => Promise<Instance>;
    /** Wraps a pooled instance for the establish/wipe hooks, plugins included. */
    createQueryBuilder: (instance: Instance) => AnyKysely;
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

interface DomainMetadata {
    checkConstraints: string;
    collation: string | null;
    default: string | null;
    name: string;
    notNull: boolean;
    schema: string;
    underlyingType: string;
}
interface ExtensionMetadata {
    name: string;
    schema: string | null;
}
/**
 * The metadata for one Postgres domain, or `undefined` when nothing by that
 * name exists.
 *
 * `domainName` is matched schema-qualified when it carries a `.` —
 * `app.template_status` — and on the domain name alone when it does not.
 *
 * ```ts
 * expect(await getDomain(db, 'app.template_status')).toBeUndefined();
 * ```
 */
declare function getDomain(db: AnyKysely, domainName: string): Promise<DomainMetadata | undefined>;
/**
 * The metadata for several Postgres domains in one query, keyed by the names
 * that were asked for — so a name that matched nothing is present and
 * `undefined` rather than absent.
 */
declare function getDomains<const Names extends string[] | readonly string[]>(db: AnyKysely, domainNames: Names): Promise<Record<Names[number], DomainMetadata | undefined>>;
/**
 * The name and schema of one installed Postgres extension, or `undefined` when
 * it is not installed.
 *
 * `extensionName` is matched schema-qualified when it carries a `.` —
 * `public.citext` — and on the extension name alone when it does not.
 *
 * ```ts
 * expect(await getExtension(db, 'public.citext')).toBeDefined();
 * ```
 */
declare function getExtension(db: AnyKysely, extensionName: string): Promise<ExtensionMetadata | undefined>;
/**
 * The installed Postgres extensions among those asked for, keyed by the names
 * that were asked for — so one that is not installed is present and
 * `undefined` rather than absent.
 */
declare function getExtensions<const Names extends string[] | readonly string[]>(db: AnyKysely, extensionNames: Names): Promise<Record<Names[number], ExtensionMetadata | undefined>>;

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
interface Options<MigrationState> {
    /**
     * How far to migrate: a step name to stop after, or `null` for a bare
     * database with no migration applied. Defaults to the last step in
     * `migrationOrder`.
     */
    migrationState?: MigrationState;
}
interface MockSqliteDatabaseFactory<Config extends FactoryConfig> {
    /** An empty in-memory database, with neither base state nor migrations. */
    createBareDatabase: () => AnyKysely;
    /** A new in-memory database, migrated to the requested state. */
    createMockDatabase: (options?: Options<Migrations<Config>>) => Promise<AnyKysely>;
    /** Wipes an existing handle and rebuilds it at the requested state. */
    restoreMockDatabase: (db: AnyKysely, options?: Options<Migrations<Config>>) => Promise<void>;
    /** Strips an existing handle back to bare, dropping everything in it. */
    wipeMockDatabase: (db: AnyKysely) => Promise<void>;
}

/**
 * A set of helpers that build throwaway in-memory sqlite databases from a
 * migration list — each one created per call rather than leased, for the tests
 * where the schema is all that is needed and startup cost matters more than
 * dialect fidelity.
 *
 * ```ts
 * export const { createMockDatabase } = createMockSqliteDatabaseFactory({
 *   migrationOrder: MIGRATION_ORDER,
 *   migrations: { createUserTable: join(import.meta.dirname, 'steps', 'createUserTable.ts') },
 * });
 * ```
 */
declare function createMockSqliteDatabaseFactory<const Config extends FactoryConfig>(config: Config): MockSqliteDatabaseFactory<Config>;

export { connectPooledPglite, createMockSqliteDatabaseFactory, createPglitePoolGlobalSetup, createPooledPglite, extendExpect, getDomain, getDomains, getExtension, getExtensions, getPooledPglite, getTable, getTables, resetPooledPglite, wipePglite };
export type { AnyKysely, DomainMetadata, ExtendExpectOptions, ExtensionMetadata, FactoryConfig, MigrationState, MockSqliteDatabaseFactory, Options, PgliteInstance, PglitePoolConfig, PglitePoolGlobalSetup, PglitePoolGlobalSetupOptions, PooledPgliteOptions };
