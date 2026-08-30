import { type NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  AUCTION_BID_KIND,
  auctionAddress,
  dedupeAuctionListings,
  parseAuctionBid,
  summarizeBids,
  type AuctionBid,
  type AuctionListing,
  type AuctionBidState,
} from '@/lib/cashu/auction';
import { NIP99_CLASSIFIED_KIND } from '@/lib/nip99';

const QUERY_LIMIT = 200;
const LOOKBACK_DAYS = 90;
const TIMEOUT_MS = 10_000;

/**
 * List active auction listings (kind 30402 with the `auction` tag) from the
 * app's relay pool. Deduplicated per NIP-33 address, sorted by close time.
 */
export function useAuctions() {
  const { nostr } = useNostr();

  const { data: rawEvents = [], isLoading, error, refetch } = useQuery<NostrEvent[]>({
    queryKey: ['cashu-auctions', 'list'],
    queryFn: async ({ signal }) => {
      const since = Math.floor(Date.now() / 1000) - 86400 * LOOKBACK_DAYS;
      const events = await nostr.query(
        [
          {
            kinds: [NIP99_CLASSIFIED_KIND],
            '#t': ['auction'],
            since,
            limit: QUERY_LIMIT,
          },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) },
      );
      // Structural filter + dedupe happens in the memo below; return raw.
      return events.sort((a, b) => b.created_at - a.created_at);
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const auctions = useMemo(() => dedupeAuctionListings(rawEvents), [rawEvents]);

  return { auctions, isLoading, error: error ? String(error) : null, refetch };
}

/**
 * Fetch all bids (kind 30401) for one auction and reduce them to display
 * state (highest bid, sorted list, next minimum bid).
 */
export function useAuctionBids(auction: AuctionListing | null | undefined) {
  const { nostr } = useNostr();
  const address = auction ? auctionAddress(auction.pubkey, auction.dTag) : null;

  const { data: rawBids = [], isLoading, refetch } = useQuery<NostrEvent[]>({
    queryKey: ['cashu-auction-bids', address],
    queryFn: async ({ signal }) => {
      if (!address) return [];
      return nostr.query(
        [
          {
            kinds: [AUCTION_BID_KIND],
            '#a': [address],
            limit: QUERY_LIMIT,
          },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) },
      );
    },
    enabled: !!address,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const bidState: AuctionBidState = useMemo(
    () => summarizeBids(
      rawBids.map(parseAuctionBid).filter((b): b is AuctionBid => b !== null),
      auction?.startingSats ?? 1,
    ),
    [rawBids, auction?.startingSats],
  );

  return { bidState, isLoading, refetch };
}
