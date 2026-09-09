import { appendFileSync } from 'node:fs';

export type PoolLog = (message: string) => void;

/** Stands in until the pool has a directory to write its log into. */
export const NO_POOL_LOG: PoolLog = function discardPoolLog() {
  // The pool cannot be reached before its socket exists, so nothing that
  // logs can run while this is still in place.
};

/**
 * Builds the pool process's logger, writing to a file it opens itself rather
 * than to stdout.
 *
 * stdout here is inherited, so it belongs to whatever process forked the pool —
 * and the whole reason the pool outlives that process is that vitest does not
 * keep it around. Once the parent is gone those writes go nowhere, which is how
 * a pool that died mid-run managed to say nothing about it.
 */
export function createPoolLog(logPath: string): PoolLog {
  return (message) => {
    try {
      appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
    } catch {
      // Stopping removes this file, and the exit handler still runs afterwards.
      // A diagnostic that takes the process down is worse than a lost line.
    }
  };
}
