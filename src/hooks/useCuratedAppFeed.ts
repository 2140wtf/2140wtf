import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { APP_CURATED_FEED_RELAYS } from '@/lib/appRelays';
import { getPaginationCursor } from '@/lib/feedUtils';

/**
 * The 2140.wtf tab should show posts only from the official 2140.wtf account.
 *
 * npub1lwsmhk9t2le9see32l006khunnk6qpxxs30enke3d8lykcd6wstqegy86j
 */
const FEATURED_APP_PUBKEYS = [
  'fba1bbd8ab57f258673157defd5afc9ceda004c6845f99db3169fe4b61ba7416',
];

/** Only standard post kinds: short notes and long-form articles. */
const APP_FEED_KINDS = [1, 30023];

/**
 * Curated 2140.wtf feed: posts from the official 2140.wtf account only.
 *
 * - No likes/reactions (kind 7).
 * - No reposts (kind 6/16).
 * - No content from other accounts, even if the curator follows them.
 */
export function useCuratedAppFeed(enabled: boolean) {
  const { nostr } = useNostr();

  return useInfiniteQuery<NostrEvent[], Error>({
    queryKey: ['app-curated-feed'],
    queryFn: async ({ pageParam, signal }) => {
      const filter: Record<string, unknown> = {
        kinds: APP_FEED_KINDS,
        authors: FEATURED_APP_PUBKEYS,
        limit: 20,
      };
      if (pageParam) filter.until = pageParam;

      const appRelays = nostr.group(APP_CURATED_FEED_RELAYS);
      const events = new Map<string, NostrEvent>();

      // Use req() so we can gather events from *all* relays in the group.
      // query() stops on the first EOSE, which only returns the fastest
      // relay's subset. We wait for every relay to finish (or a timeout).
      try {
        const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
        for await (const msg of appRelays.req(
          [filter] as Parameters<typeof appRelays.req>[0],
          { signal: combinedSignal, eoseTimeout: 6000 },
        )) {
          if (msg[0] === 'EVENT') {
            events.set(msg[2].id, msg[2]);
          }
        }
      } catch {
        // Return whatever we collected before the timeout/abort.
      }

      const sorted = [...events.values()].sort((a, b) => b.created_at - a.created_at);
      return sorted.slice(0, 20);
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length === 0) return undefined;
      return getPaginationCursor(lastPage) - 1;
    },
    initialPageParam: undefined as number | undefined,
    enabled: enabled && FEATURED_APP_PUBKEYS.length > 0,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
