import { sql } from 'kysely';
import type { AnyKysely } from '../../src/types.js';

export async function up(db: AnyKysely): Promise<void> {
  await db.schema
    .createTable('widget')
    .addColumn('id', 'integer', (col) => col.notNull().autoIncrement().primaryKey())
    .addColumn('category_id', 'integer', (col) => col.notNull().references('category.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`))
    .execute();

  await db.schema.createIndex('widget_category_id_idx').on('widget').column('category_id').execute();

  await sql
    .raw(
      `
    CREATE TRIGGER widget_updated_at
    AFTER UPDATE ON "widget"
    BEGIN
      UPDATE "widget" SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
    END
  `,
    )
    .execute(db);
}

export async function down(db: AnyKysely): Promise<void> {
  await db.schema.dropTable('widget').execute();
}
