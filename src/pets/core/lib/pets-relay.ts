import type { NPool, NostrFilter, NostrEvent } from '@nostrify/nostrify';

/**
 * Query the user's configured relays for pet events.
 *
 * Pet state (kind 31124), Nostr pet profile (kind 11125), and pet interaction
 * (kind 1124) events are read from the same effective relay pool as the rest of
 * the app, rather than a single dedicated relay.
 */
export function queryPetsRelay(
  nostr: NPool,
  filters: NostrFilter[],
  opts?: { signal?: AbortSignal },
): Promise<NostrEvent[]> {
  return nostr.query(filters, opts);
}
