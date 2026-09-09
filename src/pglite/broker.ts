import { mkdtemp, rm } from 'node:fs/promises';
import type { Server, Socket } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { AnyKysely } from '../types.js';
import type { MigrationState, PglitePool, PglitePoolConfig } from './internalTypes.js';
import type { PoolLog } from './log.js';
import { createPoolLog, NO_POOL_LOG } from './log.js';
import type { PoolRequest, PoolResponse } from './protocol.js';
import { createFrameReader, getSerializedError, sendFrame } from './protocol.js';
import { createSchemaChangeDetector, getSchemaChangeStatus } from './schemaChange.js';

const DEFAULT_SIZE = 2;
// Table names arrive already quoted, so anything a name could legally contain
// is a bad delimiter. This one cannot appear in an identifier at all.
const SEPARATOR = '\u0001';

const TABLE_QUERY = `
  SELECT table_schema, table_name FROM information_schema.tables
  WHERE table_type = 'BASE TABLE'
    AND table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name
`;

interface Baseline {
  /** Sequence positions the moment `establish` finished, so a used one still counts as a write. */
  sequences: string;
  /** Tables the reset empties — every table except the ones `establish` seeded. */
  truncatable: string[];
  /** Reads back which of `truncatable` hold rows, and where the sequences stand. */
  writeQuery: string;
}

interface WriteState {
  populated: string;
  sequences: string;
}

interface PoolEntry {
  baseline: Baseline | null;
  db: AnyKysely;
  instance: PGlite;
  leased: boolean;
  state: MigrationState;
}

/**
 * Ends whatever transaction the lease left open.
 *
 * A test that hit a constraint inside a transaction and never rolled back hands
 * the instance over with its session aborted, where every later statement fails
 * with the same unrelated complaint — the reset's own reads included. Postgres
 * only warns when there is nothing to roll back, so running this on every
 * release is cheaper than working out whether it is needed.
 */
async function endTransaction(instance: PGlite): Promise<void> {
  await instance.query('ROLLBACK');
}

async function getTables(instance: PGlite): Promise<string[]> {
  // biome-ignore lint/style/useNamingConvention: PGlite instance expects snake_case.
  const { rows } = await instance.query<{ table_name: string; table_schema: string }>(TABLE_QUERY);

  return rows.map((row) => `"${row.table_schema}"."${row.table_name}"`);
}

/**
 * Builds the query that reports what a test wrote.
 *
 * One statement rather than a `SELECT 1` per table, because a rebuild used to
 * spend more time walking that loop than running the query it was helping. The
 * sequence half is the reason a table reading empty is not enough on its own: a
 * test that inserted and then deleted its own rows leaves a sequence advanced,
 * and only `RESTART IDENTITY` puts that back.
 */
function createWriteQuery(tables: string[]): string {
  const candidates = tables
    .map((table) => `('${table.replaceAll("'", "''")}', EXISTS(SELECT 1 FROM ${table}))`)
    .join(', ');
  const populated =
    tables.length === 0
      ? `''`
      : `coalesce((
          SELECT string_agg(name, E'\\x01' ORDER BY name)
          FROM (VALUES ${candidates}) AS candidate(name, populated)
          WHERE populated
        ), '')`;

  return `
    SELECT ${populated} AS populated, coalesce((
      SELECT md5(string_agg(
        schemaname || '.' || sequencename || ':' || coalesce(last_value::text, ''),
        ',' ORDER BY schemaname, sequencename
      )) FROM pg_catalog.pg_sequences
    ), '') AS sequences
  `;
}

async function getWriteState(instance: PGlite, writeQuery: string): Promise<WriteState> {
  const { rows } = await instance.query<WriteState>(writeQuery);

  return rows[0] ?? { populated: '', sequences: '' };
}

function getPopulatedTables(state: WriteState): string[] {
  return state.populated.length > 0 ? state.populated.split(SEPARATOR) : [];
}

/**
 * Reads the shape a given migration state leaves behind: which tables the reset
 * is allowed to empty, and where the sequences start.
 *
 * The tables `establish` seeds are the ones a truncate has to leave alone — the
 * migrator's own bookkeeping, without which the next rebuild would try to
 * replay migrations over a live schema.
 */
async function readBaseline(instance: PGlite): Promise<Baseline> {
  const tables = await getTables(instance);
  const seeded = await getWriteState(instance, createWriteQuery(tables));
  const truncatable = tables.filter((table) => !getPopulatedTables(seeded).includes(table));

  return {
    sequences: seeded.sequences,
    truncatable,
    writeQuery: createWriteQuery(truncatable),
  };
}

/**
 * Boots a fixed set of pglite instances in the calling process and lends them
 * out, one test at a time, over a unix socket.
 *
 * The ceiling on live databases stops being a `maxWorkers` convention every
 * test file has to be filed under, and becomes the pool size — a test that
 * never asks for a lease is never throttled, whatever its file is named.
 */
export async function createPglitePool(config: PglitePoolConfig): Promise<PglitePool> {
  const size = config.size ?? DEFAULT_SIZE;
  const entries: PoolEntry[] = [];
  const waiting: Array<{ resolve: (entry: PoolEntry) => void; state: MigrationState }> = [];
  // `establish` is deterministic, so every instance brought to a given state has
  // the same tables and the same seeded rows. Reading that back is most of what
  // a rebuild costs once the migrations themselves are done, and the migration
  // tests rebuild the same handful of states over and over.
  const baselines = new Map<string, Baseline>();
  // Assigned once the socket directory exists, further down. Nothing can log
  // before then: every path that logs runs in response to a worker, and no
  // worker can connect until the server is listening in that directory.
  let log: PoolLog = NO_POOL_LOG;

  async function getBaseline(instance: PGlite, state: MigrationState): Promise<Baseline> {
    const key = getStateKey(state);
    const cached = baselines.get(key);

    if (cached) {
      return cached;
    }

    const baseline = await readBaseline(instance);
    baselines.set(key, baseline);

    return baseline;
  }

  for (let index = 0; index < size; index += 1) {
    const instance = await config.createInstance();
    const db = config.createQueryBuilder(instance);

    await config.establish(db, undefined);
    await createSchemaChangeDetector(instance);

    entries.push({
      baseline: await getBaseline(instance, undefined),
      db,
      instance,
      leased: false,
      state: undefined,
    });
  }

  /**
   * Empties the tables rather than rebuilding the schema.
   *
   * Replaying every migration is what a test file used to pay once; charging it
   * to every test instead is what made an early pool slower than the thing it
   * replaced. A truncate leaves schema, views, triggers and sequences in place,
   * which is all a test needed from the rebuild — but only for a test that left
   * the schema alone, which is what the detector is asked first.
   */
  async function clearEntry(entry: PoolEntry): Promise<void> {
    if (stopping) {
      return;
    }

    await endTransaction(entry.instance);

    const baseline = entry.baseline;
    const { armed, changed } = await getSchemaChangeStatus(entry.instance);

    if (baseline === null || changed || !armed) {
      await setEntryState(entry, entry.state);

      return;
    }

    const written = await getWriteState(entry.instance, baseline.writeQuery);

    // A test that read and wrote nothing needs no clearing at all, and plenty of
    // them do exactly that — every assertion about the schema itself, for one.
    if (written.populated === '' && written.sequences === baseline.sequences) {
      return;
    }

    if (baseline.truncatable.length > 0) {
      await entry.instance.query(`TRUNCATE ${baseline.truncatable.join(', ')} RESTART IDENTITY CASCADE`);
    }
  }

  async function setEntryState(entry: PoolEntry, state: MigrationState): Promise<void> {
    await config.wipe(entry.db);
    await config.establish(entry.db, state);
    // Last, so the detector starts from a schema it did not watch being built,
    // and so `wipe` dropping the schema it lives in cannot leave it half-armed.
    await createSchemaChangeDetector(entry.instance);

    entry.baseline = await getBaseline(entry.instance, state);
    entry.state = state;
  }

  /**
   * Hands out an instance already sitting at the requested state where one is
   * free, since matching costs a truncate and mismatching costs a migration
   * replay. Only the migration-step tests ask for anything but the default.
   */
  async function acquireEntry(state: MigrationState): Promise<PoolEntry> {
    const free = entries.filter((e) => !e.leased);
    const chosen = free.find((e) => isReusable(e, state)) ?? free[0];

    if (chosen) {
      chosen.leased = true;
    }

    const entry =
      chosen
      ?? (await new Promise<PoolEntry>((resolve) => {
        waiting.push({ resolve, state });
      }));

    if (isReusable(entry, state)) {
      return entry;
    }

    try {
      await setEntryState(entry, state);
    } catch (error) {
      // Handing the instance back matters more than this one failure: a lease
      // held by a migration that threw would take the instance out of the pool
      // for the rest of the run, and every later test would queue behind it
      // with nothing to say why.
      surrenderEntry(entry);

      throw error;
    }

    return entry;
  }

  /**
   * Whether an instance can be lent out as it stands.
   *
   * The missing baseline is the half that matters: an entry whose clearing
   * threw is still sitting at its old state, so asking only about the state
   * hands the next test the instance that just failed — and it fails again, on
   * something that has nothing to do with what it was testing.
   */
  function isReusable(entry: PoolEntry, state: MigrationState): boolean {
    return entry.state === state && entry.baseline !== null;
  }

  function surrenderEntry(entry: PoolEntry): void {
    // The state is unknown after a failed rebuild, so the next lease to take
    // this instance rebuilds rather than trusting a truncate.
    entry.baseline = null;

    const next = waiting.shift();

    if (next) {
      next.resolve(entry);

      return;
    }

    entry.leased = false;
  }

  /**
   * Answers the releasing worker straight away and clears behind it. The test
   * that just finished has nothing left to learn from the wait, and the next
   * one only blocks if the pool is actually contended.
   */
  function releaseEntry(entry: PoolEntry): void {
    void clearEntry(entry).then(
      () => {
        const next = waiting.shift();

        if (next) {
          next.resolve(entry);

          return;
        }

        entry.leased = false;
      },
      (error: unknown) => {
        // Same reasoning as a failed acquire, and louder: nobody is awaiting
        // this, so an unhandled rejection here would take the pool process down
        // and leave every worker waiting on a socket that will never answer.
        // It goes to the pool's log because this process was forked with its
        // output ignored, which is where every one of these used to end up.
        log(`failed to clear a pooled database: ${getErrorDetail(error)}`);
        surrenderEntry(entry);
      },
    );
  }

  const sockets = new Set<Socket>();
  let lastUsedAt = Date.now();
  let stopping = false;
  const server = createServer(handleConnection);

  function handleConnection(socket: Socket): void {
    let leased: PoolEntry | null = null;
    lastUsedAt = Date.now();
    sockets.add(socket);
    // Requests are answered strictly in order: Kysely treats a lease as one
    // connection, and a reset arriving mid-query would wipe out its own results.
    let pending = Promise.resolve();

    async function handleRequest(request: PoolRequest): Promise<PoolResponse> {
      if (request.op === 'acquire') {
        if (leased !== null) {
          throw new Error('Received a second "acquire" on a connection already holding a lease.');
        }

        leased = await acquireEntry(request.state);

        return { id: request.id };
      }

      if (leased === null) {
        throw new Error(`Received "${request.op}" from a connection holding no lease.`);
      }

      if (request.op === 'release') {
        const released = leased;
        leased = null;
        releaseEntry(released);

        return { id: request.id };
      }

      if (request.op === 'reset') {
        await clearEntry(leased);

        return { id: request.id };
      }

      const { affectedRows, rows } = await leased.instance.query(request.sql, [...request.parameters], {
        rowMode: 'object',
      });

      return {
        id: request.id,
        numAffectedRows: affectedRows == null ? undefined : BigInt(affectedRows),
        rows,
      };
    }

    socket.on(
      'data',
      createFrameReader<PoolRequest>((request) => {
        pending = pending.then(async () => {
          try {
            sendFrame(socket, await handleRequest(request));
          } catch (error) {
            sendFrame(socket, { error: getSerializedError(error), id: request.id });
          }
        });
      }),
    );

    // A worker that crashes, or one whose test forgot to destroy its database,
    // still closes its socket — so the lease is the connection, and no
    // bookkeeping mistake in a test can strand an instance.
    socket.on('close', () => {
      lastUsedAt = Date.now();
      sockets.delete(socket);

      if (leased === null) {
        return;
      }

      const released = leased;
      leased = null;
      pending = pending.then(() => {
        releaseEntry(released);
      });
    });

    socket.on('error', () => {
      socket.destroy();
    });
  }

  const socketDirectory = await mkdtemp(join(tmpdir(), 'pglite-pool-'));
  const socketPath = join(socketDirectory, 'pool.sock');
  const logPath = join(socketDirectory, 'pool.log');

  log = createPoolLog(logPath);

  try {
    await listen(server, socketPath);
  } catch (error) {
    // Nothing has been put in the directory yet, and the process this runs in
    // exits straight after. Leaving it is how a pool that failed to start
    // litters the temp directory with empty ones nobody can trace to anything.
    await rm(socketDirectory, { force: true, recursive: true });

    throw error;
  }

  return {
    lastUsedAt: () => (sockets.size > 0 ? Date.now() : lastUsedAt),
    logPath,
    socketPath,
    stop: async () => {
      // Destroying the sockets below fires every close handler, and clearing an
      // instance whose database is about to be torn down only produces noise.
      stopping = true;

      for (const socket of sockets) {
        socket.destroy();
      }

      await close(server);

      for (const entry of entries) {
        await entry.db.destroy();
      }
    },
  };
}

/** Distinguishes the two stateless states from a step that happens to be named for one. */
function getStateKey(state: MigrationState): string {
  if (state === undefined) {
    return 'all:';
  }

  if (state === null) {
    return 'none:';
  }

  return `step:${state}`;
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });
}

function getErrorDetail(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
