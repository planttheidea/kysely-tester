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

export const poolConfig: PglitePoolConfig<PGlite> = {
  createInstance: async () => await PGlite.create(),
  createQueryBuilder: (instance) =>
    new Kysely({ dialect: new PGliteDialect({ pglite: instance }), plugins: [new CamelCasePlugin()] }),
  establish,
  size: 2,
  wipe: wipePglite,
};
```

`PglitePoolConfig` takes the instance type as a parameter, and naming your driver there is what gives `createInstance`
and `createQueryBuilder` their concrete types. The reason it is a parameter at all is that nothing shipped in this
package's declarations names `@electric-sql/pglite` — so a consumer who uses only the sqlite factory never has to
install it, even with `skipLibCheck` off.

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
import { getTable, getTables } from '@planttheidea/kysely-tester';

const widget = await getTable(db, 'widget');
const tables = await getTables(db, ['app.event', 'app.attendee']);
```

A name carrying a `.` is matched schema-qualified, a bare one on the table name alone — so a workspace whose tables all
live in `public` never writes the prefix, and one that spreads them across `app` and `neon_auth` can still tell
`app.event` from `neon_auth.event`. `getTables` keys its result by the names it was asked for, so a table that does not
exist is present and `undefined` rather than missing.

`getDomain`, `getDomains`, `getExtension` and `getExtensions` do the same for Postgres domains and installed extensions,
which `db.introspection` does not report at all:

```ts
import { getDomain, getExtension } from '@planttheidea/kysely-tester';

expect(await getDomain(db, 'app.template_status')).toEqual(expect.objectContaining({ underlyingType: 'text' }));
expect(await getExtension(db, 'public.citext')).toBeDefined();
```

### Matchers

Naming `@planttheidea/kysely-tester/setup` in `setupFiles` registers two matchers. `toHaveColumns` compares a table's
columns to their data types, exhaustively unless `expected` is wrapped in `expect.objectContaining`:

```ts
expect(await getTable(db, 'widget')).toHaveColumns({
  id: 'uuid',
  createdAt: 'timestamptz',
  name: 'text',
});
```

`toHaveColumn` asserts one column, optionally with its type. Negate it to assert absence, and pass only the name when
you do — `.not.toHaveColumn(name, type)` reads as "no column of that type", so a same-named column that changed type
would still satisfy it:

```ts
expect(await getTable(db, 'widget')).toHaveColumn('createdAt', 'timestamptz');
expect(await getTable(db, 'widget')).not.toHaveColumn('retiredAt');
```

Call `extendExpect()` yourself instead if you already have a setup file. Both matchers camel-case a column's name before
comparing it, which mirrors a Kysely instance carrying `CamelCasePlugin`. Turn that off for a schema whose columns are
camel-cased in the database itself, or one that mixes the two, where the dialect's own spelling is the only one that
names every column:

```ts
// testing/setup.ts
import { extendExpect } from '@planttheidea/kysely-tester';

extendExpect({ camelCase: false });
```

## Debugging a pool

The pool is silent when it works. To have it name the socket it is serving and the file it is logging to, set
`PGLITE_POOL_DEBUG`:

```sh
PGLITE_POOL_DEBUG=1 yarn test
```

The log file is the pool's own, opened by the pool process rather than inherited, so it survives the run that produced
it — which is the point, since a pool that dies mid-run outlives the vitest process that forked it. Failures to start
are always reported, debugging or not.

## Requirements

Node 22.6 or later. The pool process imports your config module directly, so it relies on Node's built-in type stripping
to read it as TypeScript.

## License

MIT
