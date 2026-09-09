import { sql } from 'kysely';
import type { AnyKysely } from '../../src/types.js';

export async function up(db: AnyKysely): Promise<void> {
  await db.schema
    .createTable('category')
    .addColumn('id', 'uuid', (col) =>
      col
        .notNull()
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: AnyKysely): Promise<void> {
  await db.schema.dropTable('category').execute();
}
