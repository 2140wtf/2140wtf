import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useMemo } from 'react';

import {
  chunkPubkeys,
  NIP85_KIND,
  NIP85_RELAY,
  parseRankAssertions,
  WOT_MAX_AUTHORS,
} from '@/lib/nip85';

/** Per-chunk relay timeout. */
const RANKS_TIMEOUT = 12_000;

/**
 * Global Web-of-Trust ranks (0..100, NIP-85 GrapeRank assertions) for a set
 * of candidate pubkeys.
 *
 * One batched query against the assertions relay (`#d` filters in chunks);
 * no signing or API key needed, so it works for logged-out guests. Ranks
 * drift slowly, so results stay fresh for 6 hours.
 *
 * Returns `ranks`: `Map<pubkey, rank>` covering only pubkeys that HAVE an
 * assertion — treat a missing entry as rank 0 ("unknown") when filtering.
 * While loading (or disabled), `ranks` is undefined and callers should show
 * the unfiltered list.
 */
export function useWotRanks(candidates: string[], enabled: boolean) {
  const { nostr } = useNostr();

  // Derive the deduplicated, capped author list from a stable key so the
  // memo doesn't rerun when callers pass a fresh array literal each render.
  const candidatesKey = candidates.join(',');
  const authors = useMemo(
    () => (candidatesKey ? [...new Set(candidatesKey.split(','))].slice(0, WOT_MAX_AUTHORS) : []),
    [candidatesKey],
  );
  const authorsKey = authors.join(',');

  const query = useQuery<Map<string, number>>({
    queryKey: ['nip85-ranks', authorsKey],
    queryFn: async ({ signal }) => {
      const relay = nostr.group([NIP85_RELAY]);
      const events: NostrEvent[] = [];
      for (const chunk of chunkPubkeys(authors)) {
        const batch = await relay.query(
          [{ kinds: [NIP85_KIND], '#d': chunk }],
          { signal: AbortSignal.any([signal, AbortSignal.timeout(RANKS_TIMEOUT)]) },
        );
        events.push(...batch);
      }
      return parseRankAssertions(events);
    },
    enabled: enabled && authors.length > 0,
    staleTime: 6 * 60 * 60 * 1000, // 6 hours — global ranks drift slowly
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
    retry: 1,
  });

  return {
    ranks: query.data,
    /** True while the first rank fetch is in flight (callers show unfiltered). */
    isLoading: enabled && authors.length > 0 && query.data === undefined && query.isPending,
    /** How many of the candidate authors have any rank assertion. */
    scoredCount: query.data?.size ?? 0,
    totalCount: authors.length,
  };
}
