import { useQuery } from '@tanstack/react-query';

import { fetchBaoMarketById } from '@/lib/baoMarketApi';
import type { BaoMarket } from '@/lib/baoMarketParser';

/**
 * Fetch a single bao.markets market by id (e.g. a ₿AO Fund milestone market).
 * Polls every 15s while the market is unresolved so odds/resolution badges
 * stay fresh without a manual refresh.
 */
export function useBaoMarket(marketId: string | null | undefined) {
  return useQuery<BaoMarket>({
    queryKey: ['bao-market', marketId],
    queryFn: ({ signal }) => fetchBaoMarketById(marketId as string, signal),
    enabled: !!marketId,
    staleTime: 15_000,
    refetchInterval: (query) =>
      query.state.data && query.state.data.state !== 'resolved' ? 15_000 : false,
    retry: 1,
  });
}
