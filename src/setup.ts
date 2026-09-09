import { extendExpect } from './expect/index.js';

/**
 * Side-effecting module for a vitest `setupFiles` entry, so a consumer gets the
 * custom matchers by naming this package rather than by writing its own file:
 *
 * ```ts
 * setupFiles: ['@planttheidea/kysely-tester/setup'],
 * ```
 */
extendExpect();
