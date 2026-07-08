import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { APP_SEARCH_RELAYS } from '@/lib/appRelays';

/** Curated kinds for the 2140.wtf feed: unique 2140.wtf content types. */
const CURATED_KINDS = [
  20,    // Photos (NIP-68)
  21,    // Videos (NIP-71)
  22,    // Short Videos (NIP-71)
  36787, // Music Tracks
  34139, // Music Playlists
  36767, // Themes
  30030, // Emoji Packs
  30009, // Badge Definitions
  10008, // Profile Badges
  30008, // Profile Badges (legacy)
  31124, // Pets
];

/**
 * Official / featured 2140.wtf account(s) whose posts are always surfaced in the
 * curated feed, regardless of whether the curator follows them.
 *
 * npub1lwsmhk9t2le9see32l006khunnk6qpxxs30enke3d8lykcd6wstqegy86j
 */
const FEATURED_APP_PUBKEYS = [
  'fba1bbd8ab57f258673157defd5afc9ceda004c6845f99db3169fe4b61ba7416',
];

/** Text note kinds for featured accounts so official announcements appear. */
const FEATURED_KINDS = [1, 30023];

/**
 * Compute a short fingerprint of a string array for use in query keys.
 * Produces a stable, content-dependent value so the query busts when
 * the actual pubkey set changes (not just its length).
 */
function fingerprint(items: string[]): string {
  // Simple djb2-style hash — fast and collision-resistant enough for a cache key.
  let hash = 5381;
  for (const item of items) {
    for (let i = 0; i < item.length; i++) {
      hash = ((hash << 5) + hash + item.charCodeAt(i)) | 0;
    }
  }
  return (hash >>> 0).toString(36);
}

/**
 * Curated 2140.wtf feed: latest content from the curator's follow list.
 * Standard NIP-01 reverse-chronological pagination (no sort:hot).
 *
 * @param authors - Pubkeys whose content to include (from useCuratorFollowList).
 * @param enabled - Whether the query should run.
 */
export function useCuratedAppFeed(authors: string[] | undefined, enabled: boolean) {
  const { nostr } = useNostr();

  // Merge the curator follow list with the featured 2140.wtf account(s) so
  // official posts always appear in the curated feed.
  const effectiveAuthors = useMemo(() => {
    const set = new Set(FEATURED_APP_PUBKEYS);
    if (authors) {
      for (const pk of authors) set.add(pk);
    }
    return Array.from(set);
  }, [authors]);

  const authorsKey = fingerprint(effectiveAuthors);

  return useInfiniteQuery<NostrEvent[], Error>({
    queryKey: ['app-curated-feed', authorsKey],
    queryFn: async ({ pageParam, signal }) => {
      const base: Record<string, unknown> = {
        kinds: CURATED_KINDS,
        authors: effectiveAuthors,
        limit: 20,
      };
      if (pageParam) base.until = pageParam;

      // Featured accounts also get standard text-note kinds so their
      // announcements / posts show up even though those kinds are normally
      // excluded from the media-focused curated feed.
      const featuredFilter: Record<string, unknown> = {
        kinds: FEATURED_KINDS,
        authors: FEATURED_APP_PUBKEYS,
        limit: 20,
      };
      if (pageParam) featuredFilter.until = pageParam;

      const appRelays = nostr.group(APP_SEARCH_RELAYS);
      return appRelays.query(
        [base, featuredFilter] as Parameters<typeof appRelays.query>[0],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) },
      );
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length === 0) return undefined;
      return lastPage[lastPage.length - 1].created_at - 1;
    },
    initialPageParam: undefined as number | undefined,
    enabled: enabled && effectiveAuthors.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

/** Re-export for use in Feed.tsx landing hero / kind lists. */
export { CURATED_KINDS };
