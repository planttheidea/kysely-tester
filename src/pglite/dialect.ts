import type { Socket } from 'node:net';
import { connect } from 'node:net';
import type {
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  QueryCompiler,
  QueryResult,
  TransactionSettings,
} from 'kysely';
import {
  CompiledQuery,
  IdentifierNode,
  PGliteAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  RawNode,
} from 'kysely';
import type { AnyKysely } from '../types.js';
import type { MigrationState } from './internalTypes.js';
import type { PoolRequestBody, PoolResponse } from './protocol.js';
import { createError, createFrameReader, sendFrame } from './protocol.js';

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (response: PoolResponse) => void;
}

/**
 * One lease on a pooled database, held for as long as the socket is open.
 *
 * Tying the lease to the connection rather than to an explicit release call is
 * what makes the pool safe against a test file that throws before its teardown
 * runs: the worker's socket closes either way, and the instance goes back.
 */
export class PooledPgliteConnection implements DatabaseConnection {
  #nextRequestId = 0;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #socket: Socket;

  constructor(socket: Socket) {
    this.#socket = socket;

    socket.on(
      'data',
      createFrameReader<PoolResponse>((response) => {
        this.#pending.get(response.id)?.resolve(response);
        this.#pending.delete(response.id);
      }),
    );

    socket.on('close', () => {
      for (const { reject } of this.#pending.values()) {
        reject(new Error('The pglite pool connection closed while a query was in flight.'));
      }

      this.#pending.clear();
    });
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const { numAffectedRows, rows } = await this.#send({
      op: 'query',
      parameters: compiledQuery.parameters,
      sql: compiledQuery.sql,
    });

    return { numAffectedRows, rows: (rows ?? []) as R[] };
  }

  async acquire(state: MigrationState): Promise<void> {
    await this.#send({ op: 'acquire', state });
  }

  async release(): Promise<void> {
    await this.#send({ op: 'release' });
  }

  async reset(): Promise<void> {
    await this.#send({ op: 'reset' });
  }

  async destroy(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.#socket.end(resolve);
    });
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield await Promise.reject(new Error('Streaming is not supported by the pooled test database.'));
  }

  async #send(request: PoolRequestBody): Promise<PoolResponse> {
    const id = this.#nextRequestId++;

    return await new Promise<PoolResponse>((resolve, reject) => {
      this.#pending.set(id, {
        reject,
        resolve: (response) => {
          if (response.error) {
            reject(createError(response.error));

            return;
          }

          resolve(response);
        },
      });

      sendFrame(this.#socket, { ...request, id });
    });
  }
}

export class PooledPgliteDriver implements Driver {
  #connection: PooledPgliteConnection | undefined;
  #initialization: Promise<void> | undefined;
  readonly #socketPath: string;
  readonly #state: MigrationState;

  constructor(socketPath: string, state: MigrationState) {
    this.#socketPath = socketPath;
    this.#state = state;
  }

  async init(): Promise<void> {
    // Kysely calls this again on the first query; the lease must be taken once.
    this.#initialization ??= this.#establish();

    await this.#initialization;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    await this.init();

    if (!this.#connection) {
      throw new Error('The pglite pool driver was not initialized.');
    }

    return this.#connection;
  }

  async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw(getBeginStatement(settings)));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('rollback'));
  }

  async savepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler['compileQuery'],
  ): Promise<void> {
    await connection.executeQuery(compileSavepoint(compileQuery, 'savepoint', savepointName));
  }

  async rollbackToSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler['compileQuery'],
  ): Promise<void> {
    await connection.executeQuery(compileSavepoint(compileQuery, 'rollback to', savepointName));
  }

  async releaseSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler['compileQuery'],
  ): Promise<void> {
    await connection.executeQuery(compileSavepoint(compileQuery, 'release', savepointName));
  }

  async releaseConnection(): Promise<void> {
    // The lease spans the whole test file, so a released query is not a released instance.
  }

  async destroy(): Promise<void> {
    if (!this.#initialization) {
      return;
    }

    // A lease still on its way is still a lease. Waiting for it here is what
    // lets a test that timed out mid-acquire hand the instance back anyway.
    await this.#initialization.catch(() => undefined);

    if (!this.#connection) {
      return;
    }

    await this.#connection.release();
    await this.#connection.destroy();
    this.#connection = undefined;
    this.#initialization = undefined;
  }

  /**
   * Discards everything the current test wrote and hands back the same freshly
   * migrated database, without giving up the lease or reconnecting.
   */
  async reset(): Promise<void> {
    await this.init();
    await this.#connection?.reset();
  }

  async #establish(): Promise<void> {
    const socket = await openSocket(this.#socketPath);
    const connection = new PooledPgliteConnection(socket);

    await connection.acquire(this.#state);

    this.#connection = connection;
  }
}

export class PooledPgliteDialect implements Dialect {
  readonly #driver: PooledPgliteDriver;

  constructor(driver: PooledPgliteDriver) {
    this.#driver = driver;
  }

  createAdapter(): DialectAdapter {
    return new PGliteAdapter();
  }

  createDriver(): Driver {
    return this.#driver;
  }

  createIntrospector(db: AnyKysely): DatabaseIntrospector {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new PostgresQueryCompiler();
  }
}

function getBeginStatement(settings: TransactionSettings): string {
  if (!settings.isolationLevel && !settings.accessMode) {
    return 'begin';
  }

  const isolationLevel = settings.isolationLevel ? ` isolation level ${settings.isolationLevel}` : '';
  const accessMode = settings.accessMode ? ` ${settings.accessMode}` : '';

  return `start transaction${isolationLevel}${accessMode}`;
}

function compileSavepoint(
  compileQuery: QueryCompiler['compileQuery'],
  command: string,
  savepointName: string,
): CompiledQuery {
  // IdentifierNode is what sanitizes the name, exactly as kysely's own drivers do.
  const node = RawNode.createWithChildren([RawNode.createWithSql(`${command} `), IdentifierNode.create(savepointName)]);

  return compileQuery(node, { queryId: 'pglite-pool-savepoint' });
}

async function openSocket(socketPath: string): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = connect(socketPath);

    socket.once('error', reject);
    socket.once('connect', () => {
      socket.removeListener('error', reject);
      resolve(socket);
    });
  });
}
