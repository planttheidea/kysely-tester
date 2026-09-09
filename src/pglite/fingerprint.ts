import { sql } from 'kysely';
import type { AnyKysely } from '../types.js';

const FINGERPRINT_QUERY = `
  WITH scoped AS (
    SELECT oid, nspname FROM pg_catalog.pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema')
      AND nspname NOT LIKE 'pg\\_%'
  )
  SELECT 'schema:' || nspname AS entry FROM scoped
  UNION ALL
  SELECT 'column:' || n.nspname || '.' || c.relname || '.' || a.attname || ':'
    || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
    || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN scoped n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  UNION ALL
  SELECT 'view:' || n.nspname || '.' || c.relname || ':' || pg_get_viewdef(c.oid)
  FROM pg_catalog.pg_class c
  JOIN scoped n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('v', 'm')
  UNION ALL
  SELECT 'index:' || n.nspname || '.' || c.relname || ':' || pg_get_indexdef(i.indexrelid)
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  JOIN scoped n ON n.oid = c.relnamespace
  UNION ALL
  SELECT 'constraint:' || n.nspname || '.' || coalesce(r.relname, '') || '.' || k.conname || ':'
    || pg_get_constraintdef(k.oid)
  FROM pg_catalog.pg_constraint k
  JOIN scoped n ON n.oid = k.connamespace
  LEFT JOIN pg_catalog.pg_class r ON r.oid = k.conrelid
  UNION ALL
  SELECT 'trigger:' || n.nspname || '.' || c.relname || '.' || t.tgname || ':'
    || pg_get_triggerdef(t.oid)
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN scoped n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'routine:' || n.nspname || '.' || p.proname || ':'
    || pg_get_function_identity_arguments(p.oid)
  FROM pg_catalog.pg_proc p
  JOIN scoped n ON n.oid = p.pronamespace
  UNION ALL
  SELECT 'sequence:' || n.nspname || '.' || c.relname
  FROM pg_catalog.pg_class c
  JOIN scoped n ON n.oid = c.relnamespace
  WHERE c.relkind = 'S'
  UNION ALL
  SELECT 'extension:' || extname FROM pg_catalog.pg_extension
  ORDER BY 1
`;

/**
 * Every piece of schema an instance is carrying, as one sorted list of lines.
 *
 * This is a test's assertion, not the pool's own reset check — the pool reads
 * an event trigger instead, which is both cheaper and complete in a way no
 * hand-written catalog query can be. What this is for is proving that: snapshot
 * an instance, run DDL, hand the lease back, and snapshot again. Two equal
 * fingerprints say the reset really did restore every column, view, index,
 * constraint and trigger — spelled out, rather than taken on the event
 * trigger's word.
 */
export async function getPgliteFingerprint(db: AnyKysely): Promise<string> {
  const { rows } = await sql.raw<{ entry: string }>(FINGERPRINT_QUERY).execute(db);

  return rows.map((row) => row.entry).join('\n');
}
