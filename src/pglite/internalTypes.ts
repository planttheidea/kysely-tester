import type { PGlite } from '@electric-sql/pglite';
import type { AnyKysely } from '../types.js';

/**
 * How far through the migration list a leased instance should be brought:
 * a step name to stop after, `null` for a bare instance with no migration
 * applied, and `undefined` for the whole list.
 */
export type MigrationState = string | null | undefined;

export interface PglitePoolConfig {
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

export interface PglitePool {
  /** When a worker last held or asked for a lease, for the idle shutdown. */
  lastUsedAt: () => number;
  socketPath: string;
  stop: () => Promise<void>;
}
