import { createRollupConfig } from '@planttheidea/build-tools';
import typescript from '@rollup/plugin-typescript';
import tsc from 'typescript';

/**
 * Entry points that ship alongside the public API but are not part of it.
 *
 * `pool` is forked as its own process by the vitest global setup, and `setup` is
 * named in a consumer's `setupFiles`. Both are reached by path or specifier at
 * runtime rather than imported, so neither needs declarations — which is also
 * why they are built here rather than through `createRollupConfig`, whose single
 * entry point drives the package's `main`/`module` fields.
 */
const SIDECAR_ENTRIES = [
  { input: 'src/pglite/pool.ts', output: 'dist/es/pool.mjs' },
  { input: 'src/setup.ts', output: 'dist/es/setup.mjs' },
];

const [index, ...rest] = createRollupConfig({
  cjs: false,
  config: 'config',
  source: 'src',
  sourceMap: false,
  umd: false,
});

const sidecars = SIDECAR_ENTRIES.map(({ input, output }) => ({
  // Reused so a sidecar treats exactly the same packages as external that the
  // public entry does, without reading the manifest a second time.
  external: index.external,
  input,
  output: { file: output, format: 'es' },
  plugins: [
    typescript({
      compilerOptions: { declaration: false, declarationDir: undefined, declarationMap: false },
      tsconfig: 'config/types/es.json',
      typescript: tsc,
    }),
  ],
  treeshake: { preset: 'smallest' },
}));

export default [index, ...rest, ...sidecars];
