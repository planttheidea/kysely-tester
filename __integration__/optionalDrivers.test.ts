import type { ConsumerProject } from './__helpers__/consumerProject.js';
import { createConsumerProject, packPackage } from './__helpers__/consumerProject.js';

/**
 * Holds the two drivers to their `peerDependenciesMeta.optional` promise.
 *
 * Both are declared optional, but declaring it is not the same as meaning it: a
 * static `import` anywhere in the module graph the public entry pulls in gets
 * hoisted and evaluated on any import of this package at all, so a consumer who
 * leases only from the pglite pool would still be made to install a native
 * sqlite binding nothing in their suite ever calls. That is invisible from the
 * in-repo suite and from `consumer.test.ts` alike, because both have every
 * driver on disk — the only way to see it is a project that deliberately
 * installs one and not the other.
 */
let tarball: string;

beforeAll(async () => {
  tarball = await packPackage();
}, 300_000);

const WIDGET_MIGRATION = `import type { AnyKysely } from '@planttheidea/kysely-tester';

  export async function up(db: AnyKysely): Promise<void> {
    await db.schema
      .createTable('widget')
      .addColumn('id', 'integer', (col) => col.primaryKey())
      .execute();
  }`;

function writeTsconfig(project: ConsumerProject, { skipLibCheck }: { skipLibCheck: boolean }): Promise<void> {
  return project.write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        noEmit: true,
        strict: true,
        skipLibCheck,
        target: 'es2022',
        types: ['node', 'vitest/globals'],
      },
      include: ['**/*.ts'],
    }),
  );
}

describe('a consumer that installs pglite and not sqlite', () => {
  let project: ConsumerProject;

  beforeAll(async () => {
    project = await createConsumerProject(tarball, { drivers: ['pglite'] });

    await writeTsconfig(project, { skipLibCheck: true });

    await project.write(
      'vitest.config.ts',
      `import { defineConfig } from 'vitest/config';

      export default defineConfig({
        test: {
          globals: true,
          globalSetup: ['./testing/globalSetup.ts'],
          setupFiles: ['@planttheidea/kysely-tester/setup'],
          testTimeout: 60_000,
        },
      });`,
    );

    await project.write('migrations/createWidgetTable.ts', WIDGET_MIGRATION);

    await project.write(
      'testing/pool.ts',
      `import { PGlite } from '@electric-sql/pglite';
      import type { AnyKysely, MigrationState, PglitePoolConfig } from '@planttheidea/kysely-tester';
      import { wipePglite } from '@planttheidea/kysely-tester';
      import { Kysely, PGliteDialect } from 'kysely';
      import { up as createWidgetTable } from '../migrations/createWidgetTable.js';

      async function establish(db: AnyKysely, state: MigrationState): Promise<void> {
        if (state !== null) {
          await createWidgetTable(db);
        }
      }

      export const poolConfig: PglitePoolConfig<PGlite> = {
        createInstance: async () => await PGlite.create(),
        createQueryBuilder: (instance) => new Kysely({ dialect: new PGliteDialect({ pglite: instance }) }),
        establish,
        size: 1,
        wipe: wipePglite,
      };`,
    );

    await project.write(
      'testing/globalSetup.ts',
      `import { join } from 'node:path';
      import { createPglitePoolGlobalSetup } from '@planttheidea/kysely-tester';

      export const { setup, teardown } = createPglitePoolGlobalSetup({
        configExport: 'poolConfig',
        configPath: join(import.meta.dirname, 'pool.ts'),
      });`,
    );

    await project.write(
      'pool.test.ts',
      `import { getPooledPglite, getTable } from '@planttheidea/kysely-tester';

      test('leases a migrated database with no sqlite driver on disk', async () => {
        const db = await getPooledPglite();

        try {
          expect(await getTable(db, 'widget')).toHaveColumns({ id: 'int4' });
        } finally {
          await db.destroy();
        }
      });`,
    );
  }, 300_000);

  afterAll(async () => {
    await project?.cleanup();
  });

  test('runs its suite without ever reaching for better-sqlite3', async () => {
    const { exitCode, output } = await project.test();

    // Both entries a test run loads have to stay clear of the driver: the public
    // one the test imports, and the pool sidecar the global setup forks.
    expect(output).not.toMatch(/better-sqlite3/);
    expect(exitCode, output).toBe(0);
  }, 300_000);

  test('typechecks against the shipped declarations', async () => {
    const { exitCode, output } = await project.typecheck();

    expect(exitCode, output).toBe(0);
  }, 300_000);

  test('has no sqlite type reference for `skipLibCheck` to be hiding', async () => {
    await writeTsconfig(project, { skipLibCheck: false });

    try {
      const { output } = await project.typecheck();

      // Deliberately not asserting a clean exit. Checking every declaration in
      // the program means grading vitest's and kysely's `.d.ts` files too, which
      // is not this package's business — the claim under test is only that no
      // complaint is about the driver that was left out.
      expect(output).not.toMatch(/better-sqlite3/);
    } finally {
      await writeTsconfig(project, { skipLibCheck: true });
    }
  }, 300_000);
});

describe('a consumer that installs sqlite and not pglite', () => {
  let project: ConsumerProject;

  beforeAll(async () => {
    project = await createConsumerProject(tarball, { drivers: ['sqlite'] });

    await writeTsconfig(project, { skipLibCheck: true });

    await project.write(
      'vitest.config.ts',
      `import { defineConfig } from 'vitest/config';

      export default defineConfig({
        test: {
          globals: true,
          setupFiles: ['@planttheidea/kysely-tester/setup'],
          testTimeout: 60_000,
        },
      });`,
    );

    await project.write('migrations/createWidgetTable.ts', WIDGET_MIGRATION);

    await project.write(
      'sqlite.test.ts',
      `import { join } from 'node:path';
      import { createMockSqliteDatabaseFactory, getTable } from '@planttheidea/kysely-tester';

      const { createMockDatabase } = createMockSqliteDatabaseFactory({
        migrationOrder: ['createWidgetTable'],
        migrations: {
          createWidgetTable: join(import.meta.dirname, 'migrations', 'createWidgetTable.ts'),
        },
      });

      test('builds a mock database with no pglite on disk', async () => {
        const db = await createMockDatabase();

        try {
          expect(await getTable(db, 'widget')).toBeDefined();
        } finally {
          await db.destroy();
        }
      });`,
    );
  }, 300_000);

  afterAll(async () => {
    await project?.cleanup();
  });

  test('runs its suite without ever reaching for pglite', async () => {
    const { exitCode, output } = await project.test();

    expect(output).not.toMatch(/@electric-sql\/pglite/);
    expect(exitCode, output).toBe(0);
  }, 300_000);

  test('typechecks against the shipped declarations', async () => {
    const { exitCode, output } = await project.typecheck();

    expect(exitCode, output).toBe(0);
  }, 300_000);

  test('has no pglite type reference for `skipLibCheck` to be hiding', async () => {
    await writeTsconfig(project, { skipLibCheck: false });

    try {
      const { output } = await project.typecheck();

      // The sqlite direction was never a runtime problem — pglite is only ever
      // an `import type` — but it was a typecheck one for as long as
      // `PglitePoolConfig` named `PGlite`, which is what `PgliteInstance` and
      // the type parameter exist to avoid. Same reasoning as the pglite
      // direction on why the exit code is not the assertion.
      expect(output).not.toMatch(/@electric-sql\/pglite/);
    } finally {
      await writeTsconfig(project, { skipLibCheck: true });
    }
  }, 300_000);
});
