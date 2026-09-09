import { PGlite } from '@electric-sql/pglite';
import { CamelCasePlugin, Kysely, PGliteDialect } from 'kysely';
import type { MigrationState, PglitePoolConfig } from '../../src/pglite/internalTypes.js';
import { wipePglite } from '../../src/pglite/wipe.js';
import type { AnyKysely } from '../../src/types.js';
import { up as createCategoryTable } from './pgliteCategoryTable.js';
import { up as createWidgetTable } from './pgliteWidgetTable.js';

const STEPS = [
  { name: 'createCategoryTable', up: createCategoryTable },
  { name: 'createWidgetTable', up: createWidgetTable },
] as const;

export type FixtureStep = (typeof STEPS)[number]['name'];

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

/**
 * The pool the package's own pglite tests lease from — the same infrastructure
 * every other package uses, pointed at two throwaway migrations.
 */
export const fixturePoolConfig: PglitePoolConfig = {
  createInstance: async () => await PGlite.create(),
  createQueryBuilder: (instance) =>
    new Kysely({
      dialect: new PGliteDialect({ pglite: instance }),
      plugins: [new CamelCasePlugin()],
    }),
  establish,
  size: 2,
  wipe: wipePglite,
};
