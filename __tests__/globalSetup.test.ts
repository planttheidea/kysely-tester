import { EventEmitter } from 'node:events';
import { createPglitePoolGlobalSetup } from '../src/pglite/globalSetup.js';

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();

  return { ...original, fork: forkMock };
});

const SOCKET_VARIABLE = 'PGLITE_POOL_SOCKET';

/**
 * Stands in for the forked pool, which is otherwise the only thing that can
 * report a socket path or a failure to produce one.
 */
class FakePool extends EventEmitter {
  exitCode: number | null = null;
  kill = vi.fn();
  send = vi.fn(() => {
    this.exitCode = 0;
    this.emit('exit', 0);

    return true;
  });

  notifyReady(socketPath: string): void {
    this.emit('message', { logPath: '/tmp/pool.log', socketPath, status: 'ready' });
  }
}

function createSetup(overrides: { size?: number } = {}) {
  return createPglitePoolGlobalSetup({
    configExport: 'poolConfig',
    configPath: '/somewhere/pool.ts',
    ...overrides,
  });
}

/**
 * Drives `setup` to completion by answering the fork it makes.
 *
 * `setup` blocks on the pool's first message, so the answer has to be queued
 * before the promise is awaited.
 */
async function startPool(setup: () => Promise<void>, answer: (pool: FakePool) => void): Promise<FakePool> {
  const pool = new FakePool();

  forkMock.mockReturnValueOnce(pool);

  const pending = setup();

  await Promise.resolve();
  answer(pool);
  await pending;

  return pool;
}

let originalSocket: string | undefined;

beforeEach(() => {
  originalSocket = process.env[SOCKET_VARIABLE];
});

afterEach(() => {
  // The package's own pglite tests lease through this variable, so a test that
  // leaves it rewritten takes the rest of the file down with it.
  if (originalSocket === undefined) {
    Reflect.deleteProperty(process.env, SOCKET_VARIABLE);
  } else {
    process.env[SOCKET_VARIABLE] = originalSocket;
  }

  vi.clearAllMocks();
});

describe('createPglitePoolGlobalSetup', () => {
  test('publishes the socket path the pool reports', async () => {
    const { setup } = createSetup();

    await startPool(setup, (pool) => {
      pool.notifyReady('/tmp/pool-a.sock');
    });

    expect(process.env[SOCKET_VARIABLE]).toBe('/tmp/pool-a.sock');
  });

  test('forks the built pool entry, not this package’s source', async () => {
    const { setup } = createSetup();

    await startPool(setup, (pool) => {
      pool.notifyReady('/tmp/pool-b.sock');
    });

    expect(forkMock.mock.calls[0]?.[0]).toMatch(/dist[/\\]es[/\\]pool\.mjs$/);
  });

  test('passes the config location and size through to the pool', async () => {
    const { setup } = createSetup({ size: 4 });

    await startPool(setup, (pool) => {
      pool.notifyReady('/tmp/pool-c.sock');
    });

    expect(forkMock.mock.calls[0]?.[1]).toEqual(['/somewhere/pool.ts', 'poolConfig', '4']);
  });

  test('sends an empty size when none is given, leaving the config’s own', async () => {
    const { setup } = createSetup();

    await startPool(setup, (pool) => {
      pool.notifyReady('/tmp/pool-d.sock');
    });

    expect(forkMock.mock.calls[0]?.[1]).toEqual(['/somewhere/pool.ts', 'poolConfig', '']);
  });
});

describe('a global setup invoked more than once', () => {
  test('forks one pool no matter how many callers ask', async () => {
    const { setup } = createSetup();

    await startPool(setup, (pool) => {
      pool.notifyReady('/tmp/pool-e.sock');
    });
    await setup();

    expect(forkMock).toHaveBeenCalledOnce();
  });

  test('keeps the pool alive while another caller still holds it', async () => {
    const { setup, teardown } = createSetup();

    const pool = await startPool(setup, (instance) => {
      instance.notifyReady('/tmp/pool-f.sock');
    });

    await setup();
    await teardown();

    expect(pool.send).not.toHaveBeenCalled();
    expect(process.env[SOCKET_VARIABLE]).toBe('/tmp/pool-f.sock');
  });

  test('stops the pool once the last caller lets go', async () => {
    const { setup, teardown } = createSetup();

    const pool = await startPool(setup, (instance) => {
      instance.notifyReady('/tmp/pool-g.sock');
    });

    await setup();
    await teardown();
    await teardown();

    expect(pool.send).toHaveBeenCalledWith({ op: 'stop' });
  });
});

describe('teardown', () => {
  test('removes the socket variable rather than blanking it', async () => {
    const { setup, teardown } = createSetup();

    await startPool(setup, (pool) => {
      pool.notifyReady('/tmp/pool-h.sock');
    });
    await teardown();

    // Assigning `undefined` would store the string "undefined", which reads back
    // as a perfectly truthy socket path and hides the "no pool is running" error.
    expect(SOCKET_VARIABLE in process.env).toBe(false);
  });

  test('starts a fresh pool after the previous one was stopped', async () => {
    const { setup, teardown } = createSetup();

    await startPool(setup, (pool) => {
      pool.notifyReady('/tmp/pool-i.sock');
    });
    await teardown();
    await startPool(setup, (pool) => {
      pool.notifyReady('/tmp/pool-j.sock');
    });

    expect(forkMock).toHaveBeenCalledTimes(2);
    expect(process.env[SOCKET_VARIABLE]).toBe('/tmp/pool-j.sock');
  });

  test('leaves an already exited pool alone', async () => {
    const { setup, teardown } = createSetup();

    const pool = await startPool(setup, (instance) => {
      instance.notifyReady('/tmp/pool-k.sock');
    });

    pool.exitCode = 1;
    await teardown();

    expect(pool.send).not.toHaveBeenCalled();
  });
});

describe('a pool that never becomes ready', () => {
  test('reports the reason the pool gave', async () => {
    const { setup } = createSetup();
    const pool = new FakePool();

    forkMock.mockReturnValueOnce(pool);

    const pending = setup();

    await Promise.resolve();
    pool.emit('message', { message: 'no such export', status: 'failed' });

    await expect(pending).rejects.toThrow('The pglite pool failed to start: no such export');
  });

  test('reports a fork that errored outright', async () => {
    const { setup } = createSetup();
    const pool = new FakePool();

    forkMock.mockReturnValueOnce(pool);

    const pending = setup();

    await Promise.resolve();
    pool.emit('error', new Error('spawn ENOENT'));

    await expect(pending).rejects.toThrow('spawn ENOENT');
  });

  test('reports a pool that exited before saying anything', async () => {
    const { setup } = createSetup();
    const pool = new FakePool();

    forkMock.mockReturnValueOnce(pool);

    const pending = setup();

    await Promise.resolve();
    pool.emit('exit', 1);

    await expect(pending).rejects.toThrow('The pglite pool exited with code 1 before it was ready.');
  });
});
