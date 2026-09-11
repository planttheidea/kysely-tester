import { sql } from 'kysely';
import { getMatches } from '../schemedName.js';
import type { AnyKysely } from '../types.js';

export interface DomainMetadata {
  checkConstraints: string;
  collation: string | null;
  default: string | null;
  name: string;
  notNull: boolean;
  schema: string;
  underlyingType: string;
}

export interface ExtensionMetadata {
  name: string;
  schema: string | null;
}

/**
 * Domains and extensions are Postgres-only, and `db.introspection` reports
 * neither, so both are read out of `pg_catalog` directly. Names are matched the
 * way `getTable` matches them: `app.status` schema-qualified, `status` bare.
 */
async function getAllDomains(db: AnyKysely): Promise<DomainMetadata[]> {
  const { rows } = await sql<DomainMetadata>`
    SELECT
      n.nspname AS "schema",
      t.typname AS "name",
      pg_catalog.format_type(t.typbasetype, t.typtypmod) AS "underlyingType",
      t.typnotnull AS "notNull",
      (
        SELECT c.collname
        FROM pg_catalog.pg_collation c, pg_catalog.pg_type bt
        WHERE c.oid = t.typcollation
          AND bt.oid = t.typbasetype
          AND t.typcollation <> bt.typcollation
      ) AS "collation",
      t.typdefault AS "default",
      pg_catalog.array_to_string(
        ARRAY(
          SELECT pg_catalog.pg_get_constraintdef(r.oid, TRUE)
          FROM pg_catalog.pg_constraint r
          WHERE t.oid = r.contypid
        ),
        ' '
      ) AS "checkConstraints"
    FROM pg_catalog.pg_type t
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype = 'd'
    ORDER BY "schema", "name"
  `.execute(db);

  return rows;
}

async function getAllExtensions(db: AnyKysely): Promise<ExtensionMetadata[]> {
  const { rows } = await sql<ExtensionMetadata>`
    SELECT e.extname AS "name", n.nspname AS "schema"
    FROM pg_catalog.pg_extension e
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  `.execute(db);

  return rows;
}

/**
 * The metadata for one Postgres domain, or `undefined` when nothing by that
 * name exists.
 *
 * `domainName` is matched schema-qualified when it carries a `.` —
 * `app.template_status` — and on the domain name alone when it does not.
 *
 * ```ts
 * expect(await getDomain(db, 'app.template_status')).toBeUndefined();
 * ```
 */
export async function getDomain(db: AnyKysely, domainName: string): Promise<DomainMetadata | undefined> {
  const domains = await getDomains(db, [domainName]);

  return domains[domainName];
}

/**
 * The metadata for several Postgres domains in one query, keyed by the names
 * that were asked for — so a name that matched nothing is present and
 * `undefined` rather than absent.
 */
export async function getDomains<const Names extends string[] | readonly string[]>(
  db: AnyKysely,
  domainNames: Names,
): Promise<Record<Names[number], DomainMetadata | undefined>> {
  return getMatches(await getAllDomains(db), domainNames);
}

/**
 * The name and schema of one installed Postgres extension, or `undefined` when
 * it is not installed.
 *
 * `extensionName` is matched schema-qualified when it carries a `.` —
 * `public.citext` — and on the extension name alone when it does not.
 *
 * ```ts
 * expect(await getExtension(db, 'public.citext')).toBeDefined();
 * ```
 */
export async function getExtension(db: AnyKysely, extensionName: string): Promise<ExtensionMetadata | undefined> {
  const extensions = await getExtensions(db, [extensionName]);

  return extensions[extensionName];
}

/**
 * The installed Postgres extensions among those asked for, keyed by the names
 * that were asked for — so one that is not installed is present and
 * `undefined` rather than absent.
 */
export async function getExtensions<const Names extends string[] | readonly string[]>(
  db: AnyKysely,
  extensionNames: Names,
): Promise<Record<Names[number], ExtensionMetadata | undefined>> {
  return getMatches(await getAllExtensions(db), extensionNames);
}
