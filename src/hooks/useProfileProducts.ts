import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { dedupeNip99Listings, type Nip99Listing } from '@/lib/nip99';

const PAGE_SIZE = 20;

/** Result page from the profile products query. */
interface ProfileProductsPage {
  listings: Nip99Listing[];
  oldestTimestamp: number | undefined;
  count: number;
}

/**
 * Queries NIP-99 classified listings (kind 30402) published by a single user.
 *
 * Listings are deduplicated by their `d` tag so the latest version of each
 * product is returned, matching the behaviour of the store feed.
 */
export function useProfileProducts(pubkey: string | undefined, enabled = true) {
  const { nostr } = useNostr();

  return useInfiniteQuery<ProfileProductsPage, Error>({
    queryKey: ['profile-products', pubkey ?? ''],
    queryFn: async ({ pageParam, signal }) => {
      if (!pubkey) return { listings: [], oldestTimestamp: undefined, count: 0 };

      const querySignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);

      const filter: Record<string, unknown> = {
        kinds: [30402],
        authors: [pubkey],
        limit: PAGE_SIZE,
      };
      if (pageParam) {
        filter.until = pageParam;
      }

      const events = await nostr.query(
        [filter as { kinds: number[]; authors: string[]; limit: number; until?: number }],
        { signal: querySignal },
      );

      const now = Math.floor(Date.now() / 1000);
      const valid = events.filter((e) => e.created_at <= now);
      const listings = dedupeNip99Listings(valid);

      const oldestTimestamp = listings.length > 0
        ? listings[listings.length - 1].createdAt
        : undefined;

      return { listings, oldestTimestamp, count: listings.length };
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.count === 0 || lastPage.oldestTimestamp === undefined) {
        return undefined;
      }
      return lastPage.oldestTimestamp - 1;
    },
    initialPageParam: undefined as number | undefined,
    enabled: !!pubkey && enabled,
    staleTime: 30 * 1000,
  });
}
