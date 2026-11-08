/**
 * Direct room-invite links.
 *
 * An invite is `https://<host>/chat/join#<fragment>`, and the fragment is the
 * whole credential - `parseJoinLink` reads nothing else. Until now that URL was
 * only accepted by pasting it into the panel, and `/chat/join` had no shell, so
 * GitHub Pages answered 404 before the app ever looked at the fragment.
 *
 * The chat surfaces now adopt the invite their own join path carries: the PATH
 * decides which surface opens the room, and the canonical `/chat/join` form is
 * what gets validated and persisted. That second part is not cosmetic -
 * `community/join.d.ts` is explicit that two URLs in circulation means two
 * credential sets for the same room.
 */

/** Paths that adopt the invite their fragment carries. */
export const JOIN_PATHS = ['/chat/join', '/fal-live/join'] as const;

/** The single URL form an invite is stored, re-shared and re-imported as. */
export const CANONICAL_JOIN_PATH = '/chat/join';

/** `/chat/join/` is the same route to Pages, so it is the same route here. */
export function normalizeJoinPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : '/';
}

export function isJoinPath(pathname: string): boolean {
  return (JOIN_PATHS as readonly string[]).includes(normalizeJoinPath(pathname));
}

/**
 * The canonical invite URL for this address bar, or null when the page is not
 * a join path or carries no fragment (nothing to adopt).
 */
export function joinLinkFromLocation(pathname: string, hash: string, origin: string): string | null {
  if (!isJoinPath(pathname)) return null;
  // Keep the fragment byte-for-byte: it is base64url JSON with a checksum over
  // the decoded fields, so any re-encoding would fail the integrity gate.
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment) return null;
  return `${origin.replace(/\/+$/, '')}${CANONICAL_JOIN_PATH}#${fragment}`;
}
