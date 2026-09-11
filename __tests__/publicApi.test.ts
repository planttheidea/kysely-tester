import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Reads the built bundle rather than `src/index.ts`, because what a consumer
 * gets is whatever survived rollup — an export dropped by tree-shaking or lost
 * to a bad `exports` map looks fine in source and is gone by the time it ships.
 */
const BUILT_ENTRY = pathToFileURL(join(import.meta.dirname, '..', 'dist', 'es', 'index.mjs')).href;

describe('the published entry point', () => {
  test('exports exactly this surface', async () => {
    const publicApi = (await import(BUILT_ENTRY)) as Record<string, unknown>;

    // Removing or renaming anything here is a breaking change for consumers
    // this repository cannot grep. Update the snapshot deliberately, with a
    // major version, rather than to make the test pass again.
    expect(Object.keys(publicApi).sort()).toMatchInlineSnapshot(`
      [
        "connectPooledPglite",
        "createMockSqliteDatabaseFactory",
        "createPglitePoolGlobalSetup",
        "createPooledPglite",
        "extendExpect",
        "getDomain",
        "getDomains",
        "getExtension",
        "getExtensions",
        "getPooledPglite",
        "getTable",
        "getTables",
        "resetPooledPglite",
        "wipePglite",
      ]
    `);
  });

  test('exports a callable for every value it names', async () => {
    const publicApi = (await import(BUILT_ENTRY)) as Record<string, unknown>;

    for (const [name, value] of Object.entries(publicApi)) {
      expect(typeof value, `${name} is not callable`).toBe('function');
    }
  });
});

describe('the setup subpath', () => {
  test('imports cleanly and leaves the matchers registered', async () => {
    const setupEntry = pathToFileURL(join(import.meta.dirname, '..', 'dist', 'es', 'setup.mjs')).href;

    await expect(import(setupEntry)).resolves.toBeDefined();

    // Registration is what the module exists for, so the matcher it registers is
    // what says it worked. That a consumer naming the subpath in `setupFiles`
    // gets the same result is covered by the integration suite.
    expect({ columns: [{ dataType: 'int4', name: 'widget_id' }], name: 'widget' }).toHaveColumns({
      widgetId: 'int4',
    });
  });
});
