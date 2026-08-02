import { useEffect } from 'react';

import type { BaoMarket } from '@/lib/baoMarketParser';

/**
 * Select a market referenced by the URL exactly once per market id.
 *
 * Odds hydration may rebuild market objects on every render. Comparing the
 * object itself would repeatedly set state and cause a maximum-update-depth
 * crash, so synchronization is intentionally keyed by the stable market id.
 */
export function useUrlSelectedBaoMarket(
  marketId: string | null,
  markets: BaoMarket[],
  selectedMarketId: string | undefined,
  selectMarket: (market: BaoMarket) => void,
): void {
  useEffect(() => {
    if (!marketId || markets.length === 0 || selectedMarketId === marketId) return;
    const market = markets.find((candidate) => candidate.marketId === marketId);
    if (market) selectMarket(market);
  }, [marketId, markets, selectedMarketId, selectMarket]);
}
