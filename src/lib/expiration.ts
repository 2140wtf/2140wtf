/**
 * NIP-40 expiration tag helpers — generic over any Nostr event/rumor tags.
 * Concord V2's disappearing messages are the main consumer; the shared chat
 * bubble uses these to badge self-destructing messages.
 */

/** Parse an `expiration` tag (unix seconds), if present and sane. */
export function expirationOf(tags: string[][]): number | undefined {
  const value = tags.find(([name]) => name === "expiration")?.[1];
  if (!value) return undefined;
  const ts = Number(value);
  return Number.isFinite(ts) && ts > 0 ? ts : undefined;
}

/** True when the event carries an expiration that has already passed. */
export function isExpired(tags: string[][], nowSecs: number): boolean {
  const expiry = expirationOf(tags);
  return expiry !== undefined && expiry <= nowSecs;
}

/** The TTL an event was published with (expiry minus its own timestamp). */
export function ttlOf(tags: string[][], createdAtSecs: number): number | undefined {
  const expiry = expirationOf(tags);
  if (expiry === undefined) return undefined;
  const ttl = expiry - createdAtSecs;
  return ttl > 0 ? ttl : undefined;
}

/** Short label for a TTL ("21m", "4h", "3d") — used as a badge. */
export function ttlBadge(secs: number): string {
  if (secs % 86400 === 0) return `${secs / 86400}d`;
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  return `${Math.round(secs / 60)}m`;
}
