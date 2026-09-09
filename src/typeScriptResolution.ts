import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

let registered = false;

/**
 * Teaches Node to follow a `.js` specifier to the `.ts` file it names.
 *
 * The modules this package imports by path — a pool config, a migration step —
 * belong to the consumer and stay TypeScript, because the point is to run the
 * migrations the test run loads rather than a build of them that may be stale.
 * Node strips types from a `.ts` file it is handed, but it will not accept a
 * `.js` specifier that names one, and writing `.js` extensions on `.ts` imports
 * is the norm in a NodeNext codebase.
 *
 * Inside a bundler this never comes up, because the bundler resolves the import
 * itself. It comes up as soon as the caller is a published package, which the
 * bundler leaves external and so hands the dynamic import straight to Node.
 *
 * The hook closes exactly that gap and nothing else: it only fires where
 * resolution already failed, only for a relative specifier, and only where the
 * `.ts` sibling is really on disk, so a genuinely missing module still reports
 * itself as missing.
 */
export function registerTypeScriptResolution(): void {
  if (registered) {
    return;
  }

  registered = true;

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
}
