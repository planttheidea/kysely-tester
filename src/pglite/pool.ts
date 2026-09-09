import { registerTypeScriptResolution } from '../typeScriptResolution.js';
import { runPool } from './server.js';

/**
 * Entry point for the pool process, built to its own file so the fork runs
 * JavaScript rather than this package's TypeScript.
 *
 * Resolution is registered before `runPool` is called, because `runPool` is what
 * imports the consumer's config module. Nothing in this package's own graph
 * needs it.
 */
registerTypeScriptResolution();

await runPool();
