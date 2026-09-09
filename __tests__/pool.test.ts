import { CamelCasePlugin, sql } from 'kysely';
import { onTestFinished } from 'vitest';
import { connectPooledPglite, createPooledPglite, getPooledPglite, resetPooledPglite } from '../src/pglite/client.js';
import { getPgliteFingerprint } from '../src/pglite/fingerprint.js';
import type { MigrationState } from '../src/pglite/internalTypes.js';
import type { AnyKysely } from '../src/types.js';
import type { FixtureStep } from './__helpers__/pglitePool.js';

async function lease(state?: FixtureStep | null): Promise<AnyKysely> {
  const db = createPooledPglite({
    plugins: [new CamelCasePlugin()],
    state: state as MigrationState,
  });

  onTestFinished(async () => {
    await db.destroy();
  });

  await connectPooledPglite(db);

  return db;
}

async function getTableNames(db: AnyKysely): Promise<string[]> {
  return (await db.introspection.getTables()).map((table) => table.name).sort();
}

async function getColumnNames(db: AnyKysely, tableName: string): Promise<string[]> {
  const tables = await db.introspection.getTables();

  return (tables.find((table) => table.name === tableName)?.columns ?? []).map((column) => column.name).sort();
}

async function getIndexNames(db: AnyKysely, tableName: string): Promise<string[]> {
  const { rows } = await sql<{
    indexname: string;
  }>`select indexname from pg_indexes where tablename = ${tableName}`.execute(db);

  return rows.map((row) => row.indexname).sort();
}

async function getTriggerNames(db: AnyKysely): Promise<string[]> {
  const { rows } = await sql<{
    tgname: string;
  }>`select tgname from pg_trigger where not tgisinternal`.execute(db);

  return rows.map((row) => row.tgname).sort();
}

describe('getPooledPglite', () => {
  test('leases a database with every migration applied', async () => {
    const db = await lease();

    expect(await getTableNames(db)).toEqual(['category', 'widget']);
  });

  test('leases a database stopped at the named migration', async () => {
    const db = await lease('createCategoryTable');

    expect(await getTableNames(db)).toEqual(['category']);
  });

  test('leases a bare database when asked for no migration at all', async () => {
    const db = await lease(null);

    expect(await getTableNames(db)).toEqual([]);
  });

  test('serves queries, including inside a transaction', async () => {
    const db = await lease();

    const written = await db.transaction().execute(async (trx) => {
      await trx.insertInto('category').values({ name: 'Tools' }).execute();

      return await trx.selectFrom('category').selectAll().execute();
    });

    expect(written).toHaveLength(1);
  });

  test('rolls a failed transaction back rather than leaving half of it behind', async () => {
    const db = await lease();

    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto('category').values({ name: 'Doomed' }).execute();

        throw new Error('abandon');
      }),
    ).rejects.toThrow('abandon');

    expect(await db.selectFrom('category').selectAll().execute()).toEqual([]);
  });

  test('reports a query error with the message and code pglite gave it', async () => {
    const db = await lease();

    await expect(sql.raw('select * from nothing_here').execute(db)).rejects.toThrow(/nothing_here/);
  });
});

describe('resetPooledPglite', () => {
  test('empties the tables without giving up the lease', async () => {
    const db = await lease();
    await db.insertInto('category').values({ name: 'Tools' }).execute();

    await resetPooledPglite(db);

    expect(await db.selectFrom('category').selectAll().execute()).toEqual([]);
    expect(await getTableNames(db)).toEqual(['category', 'widget']);
  });

  test('rebuilds the schema when a test left DDL behind', async () => {
    const db = await lease();
    await db.schema.createTable('scratch').addColumn('id', 'integer').execute();

    await resetPooledPglite(db);

    expect(await getTableNames(db)).toEqual(['category', 'widget']);
  });

  test('rebuilds the schema when a test left a column behind', async () => {
    const db = await lease();
    await db.schema.alterTable('category').addColumn('color', 'text').execute();

    await resetPooledPglite(db);

    expect(await getColumnNames(db, 'category')).not.toContain('color');
  });

  test('rebuilds the schema when a test dropped a column', async () => {
    const db = await lease();
    const before = await getColumnNames(db, 'category');
    await db.schema.alterTable('category').dropColumn('name').execute();

    await resetPooledPglite(db);

    expect(await getColumnNames(db, 'category')).toEqual(before);
  });

  test('rebuilds the schema when a test left a view behind', async () => {
    const db = await lease();
    await sql.raw('create view category_name as select name from category').execute(db);

    await resetPooledPglite(db);

    expect(await getTableNames(db)).toEqual(['category', 'widget']);
  });

  test('rebuilds the schema when a test left an index behind', async () => {
    const db = await lease();
    await db.schema.createIndex('category_name_index').on('category').column('name').execute();

    await resetPooledPglite(db);

    expect(await getIndexNames(db, 'category')).not.toContain('category_name_index');
  });

  test('rebuilds the schema when a test left a trigger behind', async () => {
    const db = await lease();
    await sql
      .raw('create function touch_category() returns trigger as $$ begin return new; end; $$ language plpgsql')
      .execute(db);
    await sql
      .raw('create trigger category_touch before update on category for each row execute function touch_category()')
      .execute(db);

    await resetPooledPglite(db);

    expect(await getTriggerNames(db)).not.toContain('category_touch');
  });

  test('rebuilds the schema when the change detector has been dropped', async () => {
    const db = await lease();
    // Standing in for a test that drops the schema the detector lives in: the
    // reset must not read "no DDL ran" off a detector that was not watching.
    await sql.raw('drop event trigger pglite_pool_schema_change_end').execute(db);
    await db.schema.alterTable('category').addColumn('color', 'text').execute();

    await resetPooledPglite(db);

    expect(await getColumnNames(db, 'category')).not.toContain('color');
  });

  test('restores every schema object the fingerprint can name', async () => {
    const db = await lease();
    const before = await getPgliteFingerprint(db);

    await db.schema.alterTable('category').addColumn('color', 'text').execute();
    await db.schema.createIndex('category_name_index').on('category').column('name').execute();
    await sql.raw('create view category_name as select name from category').execute(db);
    await sql
      .raw('create function touch_category() returns trigger as $$ begin return new; end; $$ language plpgsql')
      .execute(db);
    await sql
      .raw('create trigger category_touch before update on category for each row execute function touch_category()')
      .execute(db);
    await sql.raw('alter table widget drop column name').execute(db);

    await resetPooledPglite(db);

    expect(await getPgliteFingerprint(db)).toEqual(before);
  });

  test('refuses a database it never lent out', async () => {
    const db = await lease();
    const stranger = Object.create(db) as AnyKysely;

    await expect(resetPooledPglite(stranger)).rejects.toThrow('was not leased');
  });
});

describe('a lease that hit a database error', () => {
  // Nothing here is specific to any one kind of failure: an aborted session is
  // aborted whatever aborted it, so the cases below are a spread of SQLSTATE
  // classes rather than a list anyone has to keep in step with the schema.
  test.each([
    ['foreign key violation', `insert into widget (category_id, name) values (gen_random_uuid(), 'Orphan')`, '23503'],
    ['undefined column', `insert into category (nope) values ('x')`, '42703'],
    ['undefined table', 'insert into not_a_table (id) values (1)', '42P01'],
    ['not-null violation', 'insert into category (id, name) values (gen_random_uuid(), null)', '23502'],
    ['invalid input syntax', `insert into widget (category_id, name) values ('not-a-uuid', 'x')`, '22P02'],
    ['syntax error', 'insert into category (', '42601'],
  ])('reports %s to the test that caused it, and clears behind it', async (_name, statement, code) => {
    const db = await lease();
    await sql.raw('begin').execute(db);

    // The pool must not swallow or rewrite what the database said: the test
    // that caused this is the only one in a position to act on it.
    await expect(sql.raw(statement).execute(db)).rejects.toMatchObject({ code });

    await resetPooledPglite(db);

    expect(await db.selectFrom('category').selectAll().execute()).toEqual([]);
  });

  test('is usable again after a reset, even mid-transaction', async () => {
    const db = await lease();
    await sql.raw('begin').execute(db);
    await expect(
      db.insertInto('widget').values({ categoryId: '00000000-0000-0000-0000-000000000000', name: 'Orphan' }).execute(),
    ).rejects.toThrow();

    await resetPooledPglite(db);

    expect(await db.selectFrom('category').selectAll().execute()).toEqual([]);
  });

  test('does not poison the instances handed to later tests', async () => {
    const poisoned = await getPooledPglite<never>({ plugins: [new CamelCasePlugin()] });
    await sql.raw('begin').execute(poisoned);
    await sql.raw('drop schema public cascade').execute(poisoned);
    await poisoned.destroy();

    // More leases than the pool holds, and each handed back before the next is
    // taken, so the instance that failed is certain to come round again rather
    // than being masked by a neighbour that never saw the error.
    for (let index = 0; index < 4; index += 1) {
      const db = await getPooledPglite<never>({ plugins: [new CamelCasePlugin()] });

      expect(await getTableNames(db)).toEqual(['category', 'widget']);

      await db.destroy();
    }
  });
});

describe('a lease returned to the pool', () => {
  test('carries none of the previous test’s rows', async () => {
    const first = await getPooledPglite<never>({ plugins: [new CamelCasePlugin()] });
    await first.insertInto('category').values({ name: 'Leftover' }).execute();
    await first.destroy();

    const second = await lease();

    expect(await second.selectFrom('category').selectAll().execute()).toEqual([]);
  });
});
