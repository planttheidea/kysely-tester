import type { Kysely } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Allow wide `Kysely` instance.
export type AnyKysely = Kysely<any>;
