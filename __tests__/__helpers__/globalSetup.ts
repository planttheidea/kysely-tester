import { fileURLToPath } from 'node:url';
import { createPglitePoolGlobalSetup } from '../../src/pglite/globalSetup.js';

export const { setup, teardown } = createPglitePoolGlobalSetup({
  configExport: 'fixturePoolConfig',
  configPath: fileURLToPath(new URL('./pglitePool.ts', import.meta.url)),
});
