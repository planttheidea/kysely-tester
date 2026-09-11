import { CamelCasePlugin, sql } from 'kysely';
import { onTestFinished } from 'vitest';
import { getTable, getTables } from '../src/introspection.js';
import { connectPooledPglite, createPooledPglite } from '../src/pglite/client.js';
import type { MigrationState } from '../src/pglite/internalTypes.js';
import { getDomain, getDomains, getExtension, getExtensions } from '../src/pglite/introspection.js';
import type { AnyKysely } from '../src/types.js';
import type { FixtureStep } from './__helpers__/pglitePool.js';

async function lease(state?: FixtureStep | null): Promise<AnyKysely> {
  const db = createPooledPglite({ plugins: [new CamelCasePlugin()], state: state as MigrationState });

  onTestFinished(async () => {
    await db.destroy();
  });

  await connectPooledPglite(db);

  return db;
}

describe('getTable', () => {
  test('finds a table by its bare name', async () => {
    const db = await lease();

    expect(await getTable(db, 'widget')).toEqual(expect.objectContaining({ name: 'widget' }));
  });

  test('finds a table by its schema-qualified name', async () => {
    const db = await lease();

    expect(await getTable(db, 'public.widget')).toEqual(expect.objectContaining({ name: 'widget', schema: 'public' }));
  });

  test('does not match a qualified name against the wrong schema', async () => {
    const db = await lease();

    expect(await getTable(db, 'app.widget')).toBeUndefined();
  });

  test('tells same-named tables in different schemas apart', async () => {
    const db = await lease();

    await sql.raw('CREATE SCHEMA app').execute(db);
    await sql.raw('CREATE TABLE app.widget (id uuid PRIMARY KEY, label text)').execute(db);

    const [appWidget, publicWidget] = [await getTable(db, 'app.widget'), await getTable(db, 'public.widget')];

    expect(appWidget?.columns.map((column) => column.name)).toEqual(['id', 'label']);
    expect(publicWidget?.columns.map((column) => column.name)).toContain('category_id');
  });

  test('returns undefined for a table that does not exist', async () => {
    const db = await lease();

    expect(await getTable(db, 'nonexistent')).toBeUndefined();
  });
});

describe('getTables', () => {
  test('keys the result by the names that were asked for', async () => {
    const db = await lease();

    const tables = await getTables(db, ['public.widget', 'category']);

    expect(tables['public.widget']).toEqual(expect.objectContaining({ name: 'widget' }));
    expect(tables.category).toEqual(expect.objectContaining({ name: 'category' }));
  });

  test('returns undefined for each table that does not exist', async () => {
    const db = await lease();

    const tables = await getTables(db, ['nonexistent_a', 'public.nonexistent_b']);

    expect(tables).toEqual({ nonexistent_a: undefined, 'public.nonexistent_b': undefined });
  });

  test('returns a mix of metadata and undefined', async () => {
    const db = await lease();

    const tables = await getTables(db, ['widget', 'nonexistent']);

    expect(tables.widget).toEqual(expect.objectContaining({ name: 'widget' }));
    expect(tables.nonexistent).toBeUndefined();
  });
});

describe('getDomain', () => {
  test('returns domain metadata when the domain exists', async () => {
    const db = await lease();

    await sql.raw('CREATE DOMAIN public.foo AS TEXT').execute(db);

    expect(await getDomain(db, 'public.foo')).toEqual(
      expect.objectContaining({ name: 'foo', schema: 'public', underlyingType: 'text' }),
    );
  });

  test('finds a domain by its bare name', async () => {
    const db = await lease();

    await sql.raw('CREATE DOMAIN public.foo AS TEXT').execute(db);

    expect(await getDomain(db, 'foo')).toEqual(expect.objectContaining({ name: 'foo' }));
  });

  test('reports the check constraints a domain carries', async () => {
    const db = await lease();

    await sql.raw("CREATE DOMAIN public.foo AS TEXT NOT NULL CHECK (VALUE <> '')").execute(db);

    const domain = await getDomain(db, 'public.foo');

    expect(domain?.notNull).toBe(true);
    expect(domain?.checkConstraints).toContain('CHECK');
  });

  test('returns undefined when the domain does not exist', async () => {
    const db = await lease();

    expect(await getDomain(db, 'public.nonexistent_domain')).toBeUndefined();
  });
});

describe('getDomains', () => {
  test('returns metadata for each domain that exists', async () => {
    const db = await lease();

    await sql.raw('CREATE DOMAIN public.foo AS TEXT').execute(db);
    await sql.raw('CREATE DOMAIN public.bar AS INTEGER').execute(db);

    const domains = await getDomains(db, ['public.foo', 'public.bar']);

    expect(domains['public.foo']).toEqual(expect.objectContaining({ name: 'foo' }));
    expect(domains['public.bar']).toEqual(expect.objectContaining({ name: 'bar' }));
  });

  test('returns a mix of metadata and undefined', async () => {
    const db = await lease();

    await sql.raw('CREATE DOMAIN public.foo AS TEXT').execute(db);

    const domains = await getDomains(db, ['public.foo', 'public.nonexistent_domain']);

    expect(domains['public.foo']).toEqual(expect.objectContaining({ name: 'foo' }));
    expect(domains['public.nonexistent_domain']).toBeUndefined();
  });
});

describe('getExtension', () => {
  test('returns extension metadata when the extension exists', async () => {
    const db = await lease();

    expect(await getExtension(db, 'pg_catalog.plpgsql')).toEqual(
      expect.objectContaining({ name: 'plpgsql', schema: 'pg_catalog' }),
    );
  });

  test('finds an extension by its bare name', async () => {
    const db = await lease();

    expect(await getExtension(db, 'plpgsql')).toEqual(expect.objectContaining({ name: 'plpgsql' }));
  });

  test('returns undefined when the extension does not exist', async () => {
    const db = await lease();

    expect(await getExtension(db, 'public.nonexistent_extension')).toBeUndefined();
  });
});

describe('getExtensions', () => {
  test('returns a mix of metadata and undefined', async () => {
    const db = await lease();

    const extensions = await getExtensions(db, ['pg_catalog.plpgsql', 'public.nonexistent_extension']);

    expect(extensions['pg_catalog.plpgsql']).toEqual(expect.objectContaining({ name: 'plpgsql' }));
    expect(extensions['public.nonexistent_extension']).toBeUndefined();
  });
});
