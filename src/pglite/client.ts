import type { KyselyPlugin } from 'kysely';
import { Kysely } from 'kysely';
import type { AnyKysely } from '../types.js';
import { PooledPgliteDialect, PooledPgliteDriver } from './dialect.js';
import type { MigrationState } from './internalTypes.js';

export const POOL_SOCKET_VARIABLE = 'PGLITE_POOL_SOCKET';

const driverByDatabase = new WeakMap<object, PooledPgliteDriver>();

export interface PooledPgliteOptions {
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
export function createPooledPglite<Schema>(options: PooledPgliteOptions = {}): Kysely<Schema> {
  const driver = new PooledPgliteDriver(getPoolSocketPath(), options.state);
  const db = new Kysely<Schema>({
    dialect: new PooledPgliteDialect(driver),
    plugins: options.plugins ?? [],
  });

  driverByDatabase.set(db, driver);

  return db;
}

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
export async function connectPooledPglite(db: AnyKysely): Promise<void> {
  await getDriver(db).init();
  await db.getExecutor().provideConnection(() => Promise.resolve(undefined));
}

/**
 * Leases one pglite instance from the pool the vitest global setup started,
 * already migrated to the requested state.
 *
 * Boot and migration were paid once at startup rather than once per test, so
 * for the default state this is a socket connect and nothing more.
 */
export async function getPooledPglite<Schema>(options: PooledPgliteOptions = {}): Promise<Kysely<Schema>> {
  const db = createPooledPglite<Schema>(options);

  await connectPooledPglite(db);

  return db;
}

/**
 * Throws away everything the current test wrote and hands the same lease back
 * at the state it was leased at.
 */
export async function resetPooledPglite(db: AnyKysely): Promise<void> {
  await getDriver(db).reset();
}

function getDriver(db: AnyKysely): PooledPgliteDriver {
  const driver = driverByDatabase.get(db);

  if (!driver) {
    throw new Error('The given database was not leased from the pglite pool.');
  }

  return driver;
}

function getPoolSocketPath(): string {
  const socketPath = process.env[POOL_SOCKET_VARIABLE];

  if (!socketPath) {
    throw new Error("No pglite pool is running. Add the package's pool module to the vitest `globalSetup` list.");
  }

  return socketPath;
}
