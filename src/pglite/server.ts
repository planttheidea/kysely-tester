import { appendFileSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPglitePool } from './broker.js';
import type { PglitePool, PglitePoolConfig } from './internalTypes.js';

const IDLE_CHECK_INTERVAL = 30_000;
const IDLE_LIMIT = 600_000;

/**
 * Writes to the pool's own file rather than to stdout.
 *
 * stdout here is inherited, so it belongs to whatever process forked this one —
 * and the whole reason this process outlives that one is that vitest does not
 * keep it around. Once the parent is gone those writes go nowhere, which is how
 * a pool that died mid-run managed to say nothing about it.
 */
function log(logPath: string, message: string): void {
  try {
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Stopping removes this file, and the exit handler still runs afterwards.
    // A diagnostic that takes the process down is worse than a lost line.
  }
}

async function startPool(): Promise<PglitePool> {
  const [configPath, configExport, rawSize] = process.argv.slice(2);

  if (!configPath || !configExport) {
    throw new Error('The pool server needs a config module path and an export name.');
  }

  const module = (await import(pathToFileURL(configPath).href)) as Record<string, unknown>;
  const config = module[configExport] as PglitePoolConfig | undefined;

  if (!config) {
    throw new Error(`"${configPath}" has no "${configExport}" export.`);
  }

  const size = Number(rawSize) || config.size;

  return await createPglitePool({ ...config, size });
}

async function stopPool(pool: PglitePool): Promise<void> {
  await pool.stop();
  await rm(dirname(pool.socketPath), { force: true, recursive: true });
}

/**
 * Runs the database pool in its own process, told by argv which module holds the
 * config and which export to read it from.
 *
 * It lives out here rather than inside `globalSetup` for two reasons. Vitest
 * loads a global setup module through Vite's module runner, which has no
 * `import.meta.resolve`, so any package that uses one to anchor a path — a
 * migration runner typically does — cannot be imported there at all. And the
 * whole point of the pool is to bound the memory a test run holds, which it does
 * far better from outside the heap vitest is already filling.
 *
 * Called by `pool.ts`, which is the module actually forked. Nothing runs when
 * this module is merely evaluated, so the entry can register its resolution hook
 * before the config module named in argv is ever imported.
 */
export async function runPool(): Promise<void> {
  try {
    const pool = await startPool();
    const logPath = join(dirname(pool.socketPath), 'pool.log');

    async function stop(reason: string): Promise<never> {
      log(logPath, `stopping: ${reason}`);
      await stopPool(pool);
      process.exit(0);
    }

    log(logPath, `started as pid ${String(process.pid)}, serving ${pool.socketPath}`);

    // Nothing here writes to stdout any more, so an exit this file did not ask
    // for would otherwise be silent. `exit` fires for uncaught throws too, which
    // makes it the one handler that cannot be slipped past — only a signal that
    // cannot be caught gets past it, and that narrows the culprit by itself.
    process.on('exit', (code) => {
      log(logPath, `exiting with code ${String(code)}`);
      // Synchronous, because an exit handler is the last place anything runs, and
      // it covers the exits `stop` never reaches — an uncaught throw above all.
      rmSync(dirname(pool.socketPath), { force: true, recursive: true });
    });
    process.on('uncaughtException', (error) => {
      log(logPath, `uncaught: ${String(error.stack)}`);
    });
    process.on('unhandledRejection', (reason) => {
      log(logPath, `unhandled rejection: ${String(reason)}`);
    });

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => {
        void stop(`received ${signal}`);
      });
    }

    process.on('message', (message: { op?: string }) => {
      if (message.op === 'stop') {
        void stop('asked to');
      }
    });

    // The channel closing means the run is over, interrupted included, and going
    // with it is what stops a cancelled run from leaving two pglite instances
    // resident until something else reaps them.
    process.on('disconnect', () => {
      void stop('lost its IPC channel');
    });

    // A run killed hard enough to skip that still gets collected eventually.
    setInterval(() => {
      if (Date.now() - pool.lastUsedAt() < IDLE_LIMIT) {
        return;
      }

      void stop(`idle for ${String(IDLE_LIMIT / 60_000)} minutes`);
    }, IDLE_CHECK_INTERVAL).unref();

    process.send?.({ logPath, socketPath: pool.socketPath, status: 'ready' });
  } catch (error) {
    process.send?.({
      message: error instanceof Error ? error.message : String(error),
      status: 'failed',
    });
    process.exit(1);
  }
}
