import type { NPool, NostrFilter, NostrEvent } from '@nostrify/nostrify';

/**
 * Relay used exclusively for 2140 PETS data.
 *
 * All pet state (kind 31124), Blobbonaut profile (kind 11125), and pet
 * interaction (kind 1124) events are read from and written to this relay so
 * that testing stays off the public relay pool.
 */
export const PETS_BAO_RELAY_URL = 'wss://relay.bao.network';

/**
 * Query the pets-only BAO relay.
 */
export function queryPetsRelay(
  nostr: NPool,
  filters: NostrFilter[],
  opts?: { signal?: AbortSignal },
): Promise<NostrEvent[]> {
  return nostr.relay(PETS_BAO_RELAY_URL).query(filters, opts);
}
