import { KIND_DM_RELAYS, parseDmRelays } from "@/hooks/useDmRelayList";

import type { NostrEvent, NostrFilter } from "@nostrify/nostrify";

/** The minimal query surface of the app's relay pool that this helper needs. */
interface PoolLike {
  query(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]>;
}

/**
 * The relays a creator's new community should snapshot: their NIP-17 DM
 * relays (kind 10050). Inbox relays are curated for exactly the kind of
 * sealed, privacy-expecting traffic Concord generates — unlike NIP-65 write
 * relays, which advertise where public notes go and tend to accumulate
 * stale, general-purpose entries. Returns [] when no DM relay list is
 * published (or the lookup fails); the caller then falls back to the app
 * relays.
 */
export async function fetchCreatorDmRelays(nostr: PoolLike, pubkey: string): Promise<string[]> {
  const events = await nostr
    .query([{ kinds: [KIND_DM_RELAYS], authors: [pubkey], limit: 2 }], {
      signal: AbortSignal.timeout(6000),
    })
    .catch(() => [] as NostrEvent[]);
  const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
  return parseDmRelays(latest);
}
