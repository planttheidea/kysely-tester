import { createVitestConfig } from '@planttheidea/build-tools';

export default createVitestConfig({
  react: false,
  source: 'src',
  overrides: {
    test: {
      environment: 'node',
      // The package's own pglite tests lease from the same pool a consumer uses,
      // pointed at two throwaway migrations.
      globalSetup: ['./__tests__/__helpers__/globalSetup.ts'],
      globals: true,
      setupFiles: ['./__tests__/__helpers__/setup.ts'],
      testTimeout: 30_000,
    },
  },
});
