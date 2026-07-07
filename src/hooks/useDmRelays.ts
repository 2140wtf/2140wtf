import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { extractReadRelays } from '@/lib/inboxRelays';
import { isVerifiedOwnEvent } from '@/lib/nostrEvents';

/**
 * Extract DM relay URLs from a kind 10050 event.
 *
 * NIP-17 specifies `relay` tags containing relay URIs.
 */
export function extractDmRelays(event: { tags: string[][] }): string[] {
  const relays = new Set<string>();
  for (const [name, url] of event.tags) {
    if (name !== 'relay' || !url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'wss:') {
        relays.add(parsed.href);
      }
    } catch {
      // skip malformed URLs
    }
  }
  return [...relays];
}

/**
 * Resolve a user's preferred DM relays.
 *
 * Falls back to NIP-65 read relays when no kind 10050 event is found so the
 * app can still attempt delivery in practice. Per strict NIP-17 a recipient
 * without a kind 10050 event is "not ready to receive messages"; callers
 * should surface this appropriately when the returned array is empty.
 */
export function useDmRelays(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['dm-relays', pubkey ?? ''],
    queryFn: async ({ signal }) => {
      if (!pubkey) return [];

      const dmListEvents = await nostr.query(
        [{ kinds: [10050], authors: [pubkey], limit: 1 }],
        { signal },
      );

      if (dmListEvents.length > 0 && isVerifiedOwnEvent(dmListEvents[0], pubkey)) {
        const relays = extractDmRelays(dmListEvents[0]);
        if (relays.length > 0) return relays;
      }

      // Fallback: NIP-65 read/inbox relays.
      const nip65Events = await nostr.query(
        [{ kinds: [10002], authors: [pubkey], limit: 1 }],
        { signal },
      );

      if (nip65Events.length > 0 && isVerifiedOwnEvent(nip65Events[0], pubkey)) {
        const relays = extractReadRelays(nip65Events[0]);
        if (relays.length > 0) return relays;
      }

      return [];
    },
    enabled: !!pubkey,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000,    // 5 minutes
    retry: 1,
  });
}
