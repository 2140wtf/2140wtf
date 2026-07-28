import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useMemo } from 'react';

import {
  chunkPubkeys,
  NIP85_KIND,
  NIP85_RELAYS,
  parseRankAssertions,
  WOT_MAX_AUTHORS,
} from '@/lib/nip85';

/** Per-query relay timeout. */
const RANKS_TIMEOUT = 12_000;

/** Combine react-query's cancellation signal with a hard per-query timeout. */
function ranksSignal(signal: AbortSignal): AbortSignal {
  // AbortSignal.any is missing on older Safari — degrade to the timeout only.
  return typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, AbortSignal.timeout(RANKS_TIMEOUT)])
    : AbortSignal.timeout(RANKS_TIMEOUT);
}

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
      const relays = NIP85_RELAYS.map((url) => nostr.group([url]));
      const byId = new Map<string, NostrEvent>();
      let failedChunks = 0;

      for (const chunk of chunkPubkeys(authors)) {
        // Query every assertions relay at once; the chunk only fails if ALL
        // relays fail (a chunk with zero matching events resolves empty,
        // which is a legit "nobody here is scored" answer, not an error).
        const settled = await Promise.allSettled(
          relays.map((relay) =>
            relay.query([{ kinds: [NIP85_KIND], '#d': chunk }], { signal: ranksSignal(signal) })),
        );
        let chunkFailed = true;
        for (const result of settled) {
          if (result.status !== 'fulfilled') continue;
          chunkFailed = false;
          for (const event of result.value) byId.set(event.id, event);
        }
        if (chunkFailed) failedChunks += 1;
      }

      const chunks = chunkPubkeys(authors).length;
      if (failedChunks === chunks) {
        throw new Error(`WoT assertions unreachable on all ${relays.length} relays`);
      }
      return parseRankAssertions([...byId.values()]);
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
    /** True when every assertions relay failed (callers can offer a retry). */
    isError: enabled && authors.length > 0 && query.isError,
    /** Re-run the rank fetch after a relay failure. */
    refetch: query.refetch,
    /** How many of the candidate authors have any rank assertion. */
    scoredCount: query.data?.size ?? 0,
    totalCount: authors.length,
  };
}
