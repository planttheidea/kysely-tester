import type { AnyKysely } from '../types.js';

/**
 * How far through the migration list a leased instance should be brought:
 * a step name to stop after, `null` for a bare instance with no migration
 * applied, and `undefined` for the whole list.
 */
export type MigrationState = string | null | undefined;

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
export interface PgliteInstance {
  // `Row` is never inferred, only supplied — `instance.query<SchemaChangeStatus>(…)`
  // at each call site, which is what makes a read back row typed rather than
  // `unknown`. The rule reads the declaration alone, where that is invisible.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  query: <Row>(
    query: string,
    params?: unknown[],
    options?: { rowMode?: 'array' | 'object' },
  ) => Promise<{ affectedRows?: number; rows: Row[] }>;
}

export interface PglitePoolConfig<Instance extends PgliteInstance = PgliteInstance> {
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

export interface PglitePool {
  /** When a worker last held or asked for a lease, for the idle shutdown. */
  lastUsedAt: () => number;
  /** The pool's own log file, alongside its socket. */
  logPath: string;
  socketPath: string;
  stop: () => Promise<void>;
}
