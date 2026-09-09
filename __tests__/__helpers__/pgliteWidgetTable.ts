import { sql } from 'kysely';
import type { AnyKysely } from '../../src/types.js';

export async function up(db: AnyKysely): Promise<void> {
  await db.schema
    .createTable('widget')
    .addColumn('id', 'uuid', (col) =>
      col
        .notNull()
        .primaryKey()
        .defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('category_id', 'uuid', (col) => col.notNull().references('category.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('widget_category_id_idx').on('widget').column('category_id').execute();
}

export async function down(db: AnyKysely): Promise<void> {
  await db.schema.dropTable('widget').execute();
}
