import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { POOL_SOCKET_VARIABLE } from './client.js';

const STOP_TIMEOUT = 5000;

export interface PglitePoolGlobalSetupOptions {
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

export interface PglitePoolGlobalSetup {
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
}

interface ReadyMessage {
  logPath?: string;
  message?: string;
  socketPath?: string;
  status: 'failed' | 'ready';
}

/**
 * Builds the `setup`/`teardown` pair a vitest `globalSetup` module exports.
 *
 * The pool runs in a forked process, and its socket path reaches the workers
 * through the environment — the database package reads it from code that must
 * not import vitest, so `provide`/`inject` is not open to it.
 */
export function createPglitePoolGlobalSetup(options: PglitePoolGlobalSetupOptions): PglitePoolGlobalSetup {
  let pool: ChildProcess | undefined;
  // Vitest hands a root-level global setup to every project that extends it, so
  // the pair can be invoked more than once for one run. Counting the callers
  // keeps the last teardown from stopping a pool the others are still leasing
  // from — which surfaces as a refused socket, not as anything nameable.
  let holders = 0;

  return {
    setup: async () => {
      holders += 1;

      if (pool) {
        return;
      }

      pool = fork(
        getServerPath(),
        [options.configPath, options.configExport, String(options.size ?? '')],
        // Output goes to a file the pool opens itself rather than to an
        // inherited stream, so a post-mortem survives the run that produced it.
        { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
      );

      process.env[POOL_SOCKET_VARIABLE] = await getSocketPath(pool);
    },
    teardown: async () => {
      holders -= 1;

      if (holders > 0) {
        return;
      }

      await stop(pool);
      pool = undefined;
      process.env[POOL_SOCKET_VARIABLE] = undefined;
    },
  };
}

/**
 * Locates the built pool entry, which the fork runs as its own process.
 *
 * Found through the package manifest rather than a path relative to this file:
 * this module is bundled into `dist/es/index.mjs`, so its own location on disk
 * says nothing about where the pool entry sits.
 */
function getServerPath(): string {
  const manifestPath = createRequire(import.meta.url).resolve('@planttheidea/kysely-tester/package.json');

  return join(dirname(manifestPath), 'dist', 'es', 'pool.mjs');
}

async function getSocketPath(pool: ChildProcess): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    pool.once('message', (message: ReadyMessage) => {
      if (message.status === 'ready' && message.socketPath) {
        console.log(`pglite pool: serving ${message.socketPath}, logging to ${String(message.logPath)}`);
        resolve(message.socketPath);

        return;
      }

      reject(new Error(`The pglite pool failed to start: ${String(message.message)}`));
    });

    pool.once('error', reject);
    pool.once('exit', (code) => {
      reject(new Error(`The pglite pool exited with code ${String(code)} before it was ready.`));
    });
  });
}

async function stop(pool: ChildProcess | undefined): Promise<void> {
  if (pool?.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const forceStop = setTimeout(() => {
      pool.kill('SIGKILL');
      resolve();
    }, STOP_TIMEOUT);

    pool.once('exit', () => {
      clearTimeout(forceStop);
      resolve();
    });

    pool.send({ op: 'stop' });
  });
}
