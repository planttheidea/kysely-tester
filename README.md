# kysely-tester

In-memory database unit and integration testing infrastructure via `kysely`.

Two ways to give a test a real database:

- **A pooled `pglite` instance** — a live Postgres, migrated once at startup and leased per test. Use it when the thing
  under test is Postgres-specific: views, triggers, `jsonb`, window functions, the migrations themselves.
- **A `better-sqlite3` factory** — a throwaway in-memory database built per call. Use it when the schema is all you need
  and startup cost matters more than dialect fidelity.

## Installation

```sh
yarn add --dev @planttheidea/kysely-tester
```

`kysely` and `vitest` are peer dependencies. Add whichever driver you use — `@electric-sql/pglite` for the pool,
`better-sqlite3` for the factory — as a dev dependency too; both are optional peers.

## The `pglite` pool

Booting a `pglite` instance and running migrations costs seconds, and doing it per test file costs that many times over.
The pool pays it once: instances start in a separate process, get migrated, and are then handed to tests one at a time.
A test that finishes gets its instance wiped and returned, so the next one to ask finds a freshly migrated schema.

Running the pool outside the vitest process is also what bounds memory. The pool size alone caps how many databases are
resident, which leaves `maxWorkers` free to go back to the default.

### 1. Describe the pool

The config module is loaded by the pool process, which has no test runner in it — so keep this file clear of `vitest`
imports.

```ts
// testing/pool.ts
import { PGlite } from '@electric-sql/pglite';
import type { AnyKysely, MigrationState, PglitePoolConfig } from '@planttheidea/kysely-tester';
import { wipePglite } from '@planttheidea/kysely-tester';
import { CamelCasePlugin, Kysely, PGliteDialect } from 'kysely';
import { migrateTo, migrateToLatest } from '../src/migration/performMigration.js';

async function establish(db: AnyKysely, state: MigrationState): Promise<void> {
  if (state === null) {
    return;
  }

  if (state === undefined) {
    await migrateToLatest(db);

    return;
  }

  await migrateTo(db, state);
}

export const poolConfig: PglitePoolConfig = {
  createInstance: async () => await PGlite.create(),
  createQueryBuilder: (instance) =>
    new Kysely({ dialect: new PGliteDialect({ pglite: instance }), plugins: [new CamelCasePlugin()] }),
  establish,
  size: 2,
  wipe: wipePglite,
};
```

`establish` is handed a `MigrationState`: a step name to stop after, `null` for a bare instance with no migration
applied, and `undefined` for the whole list.

### 2. Point vitest at it

```ts
// testing/globalSetup.ts
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createPglitePoolGlobalSetup } from '@planttheidea/kysely-tester';

const packageRoot = dirname(createRequire(import.meta.url).resolve('my-package/package.json'));

export const { setup, teardown } = createPglitePoolGlobalSetup({
  configExport: 'poolConfig',
  configPath: join(packageRoot, 'testing', 'pool.ts'),
});
```

The config is named by path rather than imported, for two reasons. Vitest loads a global setup module through Vite's
module runner, which has no `import.meta.resolve`, so a config that anchors paths that way cannot be imported there at
all. And the pool must run the same migrations vitest loads — reading a build of them instead leaves the package that
owns the migrations testing whatever its last build happened to contain. Resolve the path in your own package, as above,
so a missing dependency fails in the setup rather than inside the pool process.

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    globalSetup: ['./testing/globalSetup.ts'],
    setupFiles: ['@planttheidea/kysely-tester/setup'],
  },
});
```

### 3. Lease one per test

```ts
import { connectPooledPglite, createPooledPglite } from '@planttheidea/kysely-tester';
import { CamelCasePlugin } from 'kysely';
import { onTestFinished } from 'vitest';

export async function getTestDatabase(): Promise<Kysely<DB>> {
  const db = createPooledPglite<DB>({ plugins: [new CamelCasePlugin()] });

  // Registered before the wait, not after: a test that times out while its lease
  // is still queued has abandoned this promise, and only an already registered
  // teardown can hand the instance back.
  onTestFinished(async () => {
    await db.destroy();
  });

  await connectPooledPglite(db);

  return db;
}
```

Call it inside the test, never at module scope — a module-scope handle holds an instance for the whole file, including
the stretches where nothing touches a database.

`getPooledPglite` collapses the two steps into one for the cases where the deferred wait does not matter, and
`resetPooledPglite` discards everything the current test wrote without giving up the lease.

## The `sqlite` factory

```ts
import { join } from 'node:path';
import { createMockSqliteDatabaseFactory } from '@planttheidea/kysely-tester';
import { MIGRATION_ORDER } from './order.js';

export const { createMockDatabase, restoreMockDatabase } = createMockSqliteDatabaseFactory({
  migrationOrder: MIGRATION_ORDER,
  migrations: MIGRATION_ORDER.reduce<Record<string, string>>((nameToPath, name) => {
    nameToPath[name] = join(import.meta.dirname, 'steps', `${name}.ts`);

    return nameToPath;
  }, {}),
});
```

Each migration module is imported by path and expected to export `up`. `createMockDatabase` builds a database migrated
to the last step by default, or to a named one via `{ migrationState }`; `restoreMockDatabase` wipes and rebuilds an
existing handle, and `wipeMockDatabase` strips it back to bare.

## Introspection and matchers

`getTable` and `getTables` read table metadata back out of a live database:

```ts
import { getTable } from '@planttheidea/kysely-tester';

const widget = await getTable(db, 'widget');
```

Naming `@planttheidea/kysely-tester/setup` in `setupFiles` registers a `toHaveColumns` matcher, which compares a table's
columns to their data types with the column names camel-cased:

```ts
expect(await getTable(db, 'widget')).toHaveColumns({
  id: 'uuid',
  createdAt: 'timestamptz',
  name: 'text',
});
```

Call `extendExpect()` yourself instead if you already have a setup file.

## Requirements

Node 22.6 or later. The pool process imports your config module directly, so it relies on Node's built-in type stripping
to read it as TypeScript.

## License

MIT
