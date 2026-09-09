import type { Socket } from 'node:net';
import { deserialize, serialize } from 'node:v8';
import type { MigrationState } from './internalTypes.js';

const HEADER_BYTES = 4;

export interface AcquireRequest {
  id: number;
  op: 'acquire';
  state: MigrationState;
}

export interface ReleaseRequest {
  id: number;
  op: 'release';
}

export interface ResetRequest {
  id: number;
  op: 'reset';
}

export interface QueryRequest {
  id: number;
  op: 'query';
  parameters: readonly unknown[];
  sql: string;
}

export type PoolRequest = AcquireRequest | QueryRequest | ReleaseRequest | ResetRequest;

/** A request before the correlation id is stamped on. Distributes over the union, unlike a bare `Omit`. */
export type PoolRequestBody =
  Omit<AcquireRequest, 'id'> | Omit<QueryRequest, 'id'> | Omit<ReleaseRequest, 'id'> | Omit<ResetRequest, 'id'>;

export interface SerializedError {
  extras: Record<string, unknown>;
  message: string;
  name: string;
  stack: string | undefined;
}

export interface PoolResponse {
  error?: SerializedError;
  id: number;
  numAffectedRows?: bigint;
  rows?: unknown[];
}

/**
 * Frames a payload as a big-endian byte count followed by v8-serialized bytes.
 *
 * v8 rather than JSON because the rows crossing this socket are already parsed
 * into JS values — `Date`, `Buffer`, `bigint` — and a JSON round trip would
 * quietly hand the test a string where pglite handed us an object.
 */
export function serializeFrame(payload: PoolRequest | PoolResponse): Buffer {
  const body = serialize(payload);
  const header = Buffer.allocUnsafe(HEADER_BYTES);

  header.writeUInt32BE(body.length);

  return Buffer.concat([header, body]);
}

/**
 * Builds a `data` handler that reassembles whole frames out of the arbitrary
 * chunk boundaries a socket delivers.
 */
// The parameter is what lets a caller name the frame shape it expects; widening
// it to `unknown` pushes a cast onto every handler.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function createFrameReader<Frame>(notifyFrame: (frame: Frame) => void): (chunk: Buffer) => void {
  let buffered = Buffer.alloc(0);

  return function readChunk(chunk: Buffer): void {
    buffered = Buffer.concat([buffered, chunk]);

    while (buffered.length >= HEADER_BYTES) {
      const length = buffered.readUInt32BE(0);

      if (buffered.length < HEADER_BYTES + length) {
        return;
      }

      const body = buffered.subarray(HEADER_BYTES, HEADER_BYTES + length);
      buffered = buffered.subarray(HEADER_BYTES + length);

      notifyFrame(deserialize(body) as Frame);
    }
  };
}

export function sendFrame(socket: Socket, payload: PoolRequest | PoolResponse): void {
  socket.write(serializeFrame(payload));
}

/**
 * Flattens an error for the wire. v8 serialization keeps `message` and `stack`
 * but drops the subclass and its own properties, and pglite's errors carry the
 * `code`/`detail`/`constraint` fields that assertions reach for.
 */
export function getSerializedError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    return { extras: {}, message: String(error), name: 'Error', stack: undefined };
  }

  const extras: Record<string, unknown> = {};
  const properties = error as unknown as Record<string, unknown>;

  for (const key of Object.keys(error)) {
    extras[key] = properties[key];
  }

  return { extras, message: error.message, name: error.name, stack: error.stack };
}

export function createError(serialized: SerializedError): Error {
  const error = new Error(serialized.message);

  error.name = serialized.name;
  error.stack = serialized.stack;

  return Object.assign(error, serialized.extras);
}
