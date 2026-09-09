import { sql } from 'kysely';
import type { AnyKysely } from '../../src/types.js';

export async function up(db: AnyKysely): Promise<void> {
  await db.schema
    .createTable('category')
    .addColumn('id', 'integer', (col) => col.notNull().autoIncrement().primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`))
    .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`))
    .execute();

  await sql
    .raw(
      `
    CREATE TRIGGER category_updated_at
    AFTER UPDATE ON "category"
    BEGIN
      UPDATE "category" SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
    END
  `,
    )
    .execute(db);
}

export async function down(db: AnyKysely): Promise<void> {
  await db.schema.dropTable('category').execute();
}
