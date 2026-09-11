export interface SchemedObject {
  name: string;
  schema?: string | null;
}

/**
 * Whether a name a test asked for names this object.
 *
 * A name carrying a `.` is matched schema-qualified, a bare one on the object's
 * own name alone. Qualification cannot be required — a workspace whose tables
 * all live in `public` would gain a prefix on every assertion and nothing else
 * — and it cannot be dropped either, because the schema is the only thing
 * telling `app.event` apart from `neon_auth.event`.
 */
export function matchesSchemedName({ name, schema }: SchemedObject, requested: string): boolean {
  if (!requested.includes('.')) {
    return name === requested;
  }

  // A dialect that reports no schema for an object has nothing to qualify, so a
  // qualified name cannot name it.
  return schema != null && `${schema}.${name}` === requested;
}

/**
 * Every requested name mapped to the object that matched it, keyed by what was
 * asked for rather than by what was found — so a name that matched nothing is
 * present and `undefined` instead of absent.
 */
export function getMatches<Metadata extends SchemedObject>(
  candidates: Metadata[],
  requestedNames: readonly string[],
): Record<string, Metadata | undefined> {
  return requestedNames.reduce<Record<string, Metadata | undefined>>((found, requested) => {
    found[requested] = candidates.find((candidate) => matchesSchemedName(candidate, requested));

    return found;
  }, {});
}
