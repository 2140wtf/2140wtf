import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useMemo } from 'react';

import { useCurrentUser } from './useCurrentUser';
import { useNostrStorage } from './useNostrStorage';
import { contactListPubkeys, fetchContactList } from '@/lib/contactList';
import {
  buildFollowGraph,
  DEFAULT_WOT_DEPTH,
  WOT_GRAPH_CAP,
  wotScores,
  type WotScore,
} from '@/lib/wot';

/** Per-fetch timeout for the depth-1 contact lists. */
const FOLLOW_LISTS_TIMEOUT = 10_000;

/**
 * Web-of-Trust scores for a set of candidate pubkeys, from the anchor's
 * perspective (default: the current user; pass `anchor` to score from a
 * community anchor instead).
 *
 * Builds a depth-`maxDepth` follow graph (default 2): the anchor's kind 3
 * via `fetchContactList` (relay read with IndexedDB fallback), then the
 * kind 3s of up to `WOT_GRAPH_CAP` (1000) of the anchor's follows in a
 * single bounded query. The fetched events are the query data
 * (queryKey `['wot', anchor, maxDepth]`, staleTime 10 minutes — follow
 * graphs drift slowly); per-candidate scores are derived from the cached
 * events with a memo, so changing the candidate list does not refetch.
 *
 * Graceful degradation: if the anchor has no kind 3 (or every fetch
 * fails), all candidates score 0 — the hook never throws.
 *
 * Returns the TanStack Query result plus `scores`:
 * `Map<pubkey, { score, distance, followersWithin }>` covering every
 * candidate. While loading, `scores` maps every candidate to a zero score.
 */
export function useWot(
  candidates: string[],
  opts: { anchor?: string; maxDepth?: number } = {},
) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { store } = useNostrStorage();

  const anchor = opts.anchor ?? user?.pubkey;
  const maxDepth = opts.maxDepth ?? DEFAULT_WOT_DEPTH;

  const query = useQuery<NostrEvent[]>({
    queryKey: ['wot', anchor, maxDepth],
    queryFn: async ({ signal }) => {
      if (!anchor) return [];

      const anchorList = await fetchContactList(nostr, store, anchor, { signal });
      if (!anchorList) return [];

      // Depth-2 expansion: the kind 3s of the anchor's follows, capped so
      // the filter stays a sane size. Follows beyond the cap become leaves.
      const depth1 = contactListPubkeys(anchorList).slice(0, WOT_GRAPH_CAP);
      if (depth1.length === 0) return [anchorList];

      const querySignal = AbortSignal.any([signal, AbortSignal.timeout(FOLLOW_LISTS_TIMEOUT)]);
      let followLists: NostrEvent[] = [];
      try {
        followLists = await nostr.query([{ kinds: [3], authors: depth1 }], { signal: querySignal });
      } catch (err) {
        // A failed depth-2 fetch still leaves a usable depth-1 graph.
        console.warn('Failed to fetch depth-1 follow lists for WoT:', err);
      }

      return [anchorList, ...followLists];
    },
    enabled: !!anchor,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
  });

  // Derive the candidate list from a stable key so the memo doesn't rerun
  // on every render when callers pass a fresh array literal.
  const candidatesKey = candidates.join(',');
  const scores = useMemo<Map<string, WotScore>>(() => {
    const list = candidatesKey ? candidatesKey.split(',') : [];
    if (!anchor || !query.data) {
      return new Map(
        list.map((pubkey) => [pubkey, { score: 0, distance: null, followersWithin: 0 }]),
      );
    }
    return wotScores(buildFollowGraph(query.data), anchor, list, maxDepth);
  }, [query.data, anchor, maxDepth, candidatesKey]);

  return { ...query, scores };
}
