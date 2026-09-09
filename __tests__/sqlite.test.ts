import { join } from 'node:path';
import { sql } from 'kysely';
import { getTable, getTables } from '../src/introspection.js';
import { createMockSqliteDatabaseFactory } from '../src/sqlite/index.js';

vi.mock('../src/sqlite/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/sqlite/index.js')>();

  return {
    ...original,
    createMockSqliteDatabaseFactory: vi.fn((order) => {
      const factory = original.createMockSqliteDatabaseFactory(order);

      return { ...factory, createBareDatabase: vi.fn(factory.createBareDatabase) };
    }),
  };
});

const { createBareDatabase, createMockDatabase, restoreMockDatabase, wipeMockDatabase } =
  createMockSqliteDatabaseFactory({
    migrationOrder: ['createCategoryTable', 'createWidgetTable'],
    migrations: {
      createCategoryTable: join(import.meta.dirname, '__helpers__', 'sqliteCategoryTable.ts'),
      createWidgetTable: join(import.meta.dirname, '__helpers__', 'sqliteWidgetTable.ts'),
    },
  });

const db = createBareDatabase();

afterEach(async () => {
  await wipeMockDatabase(db);
});

afterAll(async () => {
  await db.destroy();
});

describe('wipeMockDatabase', () => {
  test('drops all user tables', async () => {
    await db.schema.createTable('items').addColumn('id', 'integer').execute();
    await db.schema.createTable('tags').addColumn('id', 'integer').execute();

    await wipeMockDatabase(db);

    const tables = await db.introspection.getTables();

    expect(tables).toHaveLength(0);
  });

  test('drops views', async () => {
    await db.schema.createTable('items').addColumn('id', 'integer').execute();
    await sql`CREATE VIEW item_view AS SELECT id FROM items`.execute(db);

    await wipeMockDatabase(db);

    const tables = await db.introspection.getTables();

    expect(tables).toHaveLength(0);
  });

  test('is idempotent on an empty database', async () => {
    await expect(wipeMockDatabase(db)).resolves.not.toThrow();
  });
});

describe('restoreMockDatabase', () => {
  test('migrates to latest by default', async () => {
    await restoreMockDatabase(db);

    const table = await getTable(db, 'category');

    expect(table).toBeDefined();
  });

  test('skips migrations when migrationState is null', async () => {
    await restoreMockDatabase(db, { migrationState: null });

    const tables = await db.introspection.getTables();

    expect(tables).toHaveLength(0);
  });

  test('stops at the specified migration', async () => {
    await restoreMockDatabase(db, { migrationState: 'createWidgetTable' });

    const tables = await getTables(db, ['category', 'widget', 'unrelated']);

    expect(tables.category).toBeDefined();
    expect(tables.widget).toBeDefined();
    expect(tables.unrelated).toBeUndefined();
  });

  test('removes previously added tables before re-establishing', async () => {
    await restoreMockDatabase(db, { migrationState: null });

    await db.schema.createTable('extra').addColumn('id', 'integer').execute();

    await restoreMockDatabase(db, { migrationState: null });

    const extra = await getTable(db, 'extra');

    expect(extra).toBeUndefined();
  });

  test('is idempotent', async () => {
    await restoreMockDatabase(db);

    await expect(restoreMockDatabase(db)).resolves.not.toThrow();
  });
});

describe('createMockDatabase', () => {
  beforeEach(() => {
    vi.mocked(createBareDatabase).mockReturnValueOnce(db);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('returns a functional database', async () => {
    const testDb = await createMockDatabase({ migrationState: null });

    await expect(testDb.introspection.getTables()).resolves.not.toThrow();
  });

  test('runs migrations by default', async () => {
    const testDb = await createMockDatabase();

    const table = await getTable(testDb, 'category');

    expect(table).toBeDefined();
  });

  test('skips migrations when migrationState is null', async () => {
    const testDb = await createMockDatabase({ migrationState: null });

    const tables = await testDb.introspection.getTables();

    expect(tables).toHaveLength(0);
  });
});
