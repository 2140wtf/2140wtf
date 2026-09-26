// src/lib/errors.ts
//
// One place for turning an unknown thrown value into a user-displayable
// message - replaces the `err instanceof Error ? err.message : String(err)`
// boilerplate that was repeated across every catch block in src/.

/** Normalize an unknown thrown value into a message string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
