import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { APP_SEARCH_RELAYS } from '@/lib/appRelays';

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

      const appRelays = nostr.group(APP_SEARCH_RELAYS);
      return appRelays.query(
        [filter] as Parameters<typeof appRelays.query>[0],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) },
      );
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length === 0) return undefined;
      return lastPage[lastPage.length - 1].created_at - 1;
    },
    initialPageParam: undefined as number | undefined,
    enabled: enabled && FEATURED_APP_PUBKEYS.length > 0,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
