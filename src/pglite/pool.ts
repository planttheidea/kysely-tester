import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runPool } from './server.js';

/**
 * Entry point for the pool process, built to its own file so the fork runs
 * JavaScript rather than this package's TypeScript.
 *
 * The config module it goes on to load is a different matter: it belongs to the
 * consuming package and stays TypeScript, because the pool must apply the same
 * migrations vitest loads — reading a build of them instead leaves the package
 * that owns the migrations testing whatever its last build happened to contain.
 *
 * Node strips types from a `.ts` file it is handed, but it will not accept a
 * `.js` specifier that names one, and writing `.js` extensions on `.ts` imports
 * is the norm in a NodeNext codebase. The hook below closes exactly that gap and
 * nothing else: it only fires where resolution already failed, only for a
 * relative specifier, and only where the `.ts` sibling is really on disk, so a
 * genuinely missing module still reports itself as missing.
 *
 * It is registered before `runPool` is called, because `runPool` is what imports
 * the config module. Nothing in this package's own graph needs the hook.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || !specifier.endsWith('.js') || !context.parentURL) {
        throw error;
      }

      const candidate = `${specifier.slice(0, -'.js'.length)}.ts`;

      if (!existsSync(fileURLToPath(new URL(candidate, context.parentURL)))) {
        throw error;
      }

      return nextResolve(candidate, context);
    }
  },
});

await runPool();
