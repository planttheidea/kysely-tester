import type { ConsumerProject } from './__helpers__/consumerProject.js';
import { createConsumerProject, packPackage } from './__helpers__/consumerProject.js';

/**
 * Exercises the package from outside itself, against the tarball `npm publish`
 * would upload.
 *
 * Everything here is invisible to the in-repo suite by construction. The package
 * resolves its own pool entry through the manifest, hands dynamic imports of the
 * consumer's TypeScript straight to Node, and augments `vitest`'s `Matchers` from
 * a bundled declaration — none of which can be falsified from a test that shares
 * a `node_modules` with the source.
 */
let project: ConsumerProject;

beforeAll(async () => {
  project = await createConsumerProject(await packPackage());

  await project.write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        target: 'es2022',
        types: ['node', 'vitest/globals'],
      },
      include: ['**/*.ts'],
    }),
  );

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

  // Every migration below names its sibling with a `.js` extension while the
  // file on disk is `.ts` — the NodeNext convention, and the thing the package
  // has to resolve now that a bundler is no longer doing it.
  await project.write(
    'migrations/columns.ts',
    `import type { CreateTableBuilder } from 'kysely';

    export function addTimestamps<Table extends string, Column extends string>(
      builder: CreateTableBuilder<Table, Column>,
    ): CreateTableBuilder<Table, Column> {
      return builder.addColumn('created_at', 'timestamp');
    }`,
  );

  await project.write(
    'migrations/createWidgetTable.ts',
    `import type { AnyKysely } from '@planttheidea/kysely-tester';
    import { addTimestamps } from './columns.js';

    export async function up(db: AnyKysely): Promise<void> {
      await addTimestamps(
        db.schema.createTable('widget').addColumn('id', 'integer', (col) => col.primaryKey()),
      ).execute();
    }`,
  );

  await project.write(
    'migrations/createGadgetTable.ts',
    `import type { AnyKysely } from '@planttheidea/kysely-tester';
    import { addTimestamps } from './columns.js';

    export async function up(db: AnyKysely): Promise<void> {
      await addTimestamps(
        db.schema.createTable('gadget').addColumn('id', 'integer', (col) => col.primaryKey()),
      ).execute();
    }`,
  );

  await project.write(
    'testing/pool.ts',
    `import { PGlite } from '@electric-sql/pglite';
    import type { AnyKysely, MigrationState, PglitePoolConfig } from '@planttheidea/kysely-tester';
    import { wipePglite } from '@planttheidea/kysely-tester';
    import { Kysely, PGliteDialect } from 'kysely';
    import { up as createGadgetTable } from '../migrations/createGadgetTable.js';
    import { up as createWidgetTable } from '../migrations/createWidgetTable.js';

    const STEPS = [
      { name: 'createWidgetTable', up: createWidgetTable },
      { name: 'createGadgetTable', up: createGadgetTable },
    ];

    async function establish(db: AnyKysely, state: MigrationState): Promise<void> {
      if (state === null) {
        return;
      }

      for (const step of STEPS) {
        await step.up(db);

        if (step.name === state) {
          return;
        }
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
    `import { createRequire } from 'node:module';
    import { join } from 'node:path';
    import { createPglitePoolGlobalSetup } from '@planttheidea/kysely-tester';

    export const { setup, teardown } = createPglitePoolGlobalSetup({
      configExport: 'poolConfig',
      configPath: join(import.meta.dirname, 'pool.ts'),
    });`,
  );
}, 300_000);

afterAll(async () => {
  await project?.cleanup();
});

describe('a package consuming the published tarball', () => {
  test('leases a migrated pglite database and reads its schema back', async () => {
    await project.write(
      'pool.test.ts',
      `import { getPooledPglite, getTable } from '@planttheidea/kysely-tester';

      test('has every migration applied', async () => {
        const db = await getPooledPglite();

        try {
          expect(await getTable(db, 'widget')).toHaveColumns({ id: 'int4', createdAt: 'timestamp' });
          expect(await getTable(db, 'gadget')).toHaveColumns({ id: 'int4', createdAt: 'timestamp' });
        } finally {
          await db.destroy();
        }
      });

      test('stops at the named migration when asked', async () => {
        const db = await getPooledPglite({ state: 'createWidgetTable' });

        try {
          expect(await getTable(db, 'widget')).toBeDefined();
          expect(await getTable(db, 'gadget')).toBeUndefined();
        } finally {
          await db.destroy();
        }
      });`,
    );

    const { exitCode, output } = await project.test();

    expect(output).not.toMatch(/Cannot find module/);
    expect(exitCode, output).toBe(0);
  }, 300_000);

  test('builds a sqlite database from migrations that import siblings as ".js"', async () => {
    await project.write(
      'sqlite.test.ts',
      `import { join } from 'node:path';
      import { createMockSqliteDatabaseFactory, getTable } from '@planttheidea/kysely-tester';

      const { createMockDatabase } = createMockSqliteDatabaseFactory({
        migrationOrder: ['createWidgetTable', 'createGadgetTable'],
        migrations: {
          createWidgetTable: join(import.meta.dirname, 'migrations', 'createWidgetTable.ts'),
          createGadgetTable: join(import.meta.dirname, 'migrations', 'createGadgetTable.ts'),
        },
      });

      test('applies every migration through Node’s own resolver', async () => {
        const db = await createMockDatabase();

        try {
          expect(await getTable(db, 'widget')).toBeDefined();
          expect(await getTable(db, 'gadget')).toBeDefined();
        } finally {
          await db.destroy();
        }
      });`,
    );

    const { exitCode, output } = await project.test();

    // The specific failure this guards: a migration naming `./columns.js` when
    // only `./columns.ts` exists, which Node refuses and a bundler never sees.
    expect(output).not.toMatch(/Cannot find module/);
    expect(exitCode, output).toBe(0);
  }, 300_000);

  test('typechecks against the shipped declarations, matchers included', async () => {
    await project.write(
      'types.test.ts',
      `import type { AnyKysely } from '@planttheidea/kysely-tester';
      import { getPooledPglite, getTable } from '@planttheidea/kysely-tester';

      test('sees toHaveColumns on expect', async () => {
        const db: AnyKysely = await getPooledPglite();

        try {
          expect(await getTable(db, 'widget')).toHaveColumns({ id: 'int4' });
        } finally {
          await db.destroy();
        }
      });`,
    );

    const { exitCode, output } = await project.typecheck();

    expect(exitCode, output).toBe(0);
  }, 300_000);
});
