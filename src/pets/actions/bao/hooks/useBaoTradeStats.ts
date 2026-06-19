import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { BAO_RELAY_URL, aggregateBaoTradeActivity, type BaoTradeActivity } from '../lib/bao-trade-parser';

export interface UseBaoTradeStatsResult {
  activity: BaoTradeActivity | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch the logged-in user's BAO trade/order activity from the BAO relay.
 *
 * Only events authored by the user's pubkey are considered. For each order id
 * the latest event wins, so the returned activity reflects the user's current
 * open orders.
 */
export function useBaoTradeStats(pubkey: string | undefined): UseBaoTradeStatsResult {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['bao-trade-stats', pubkey ?? 'anon'],
    queryFn: async (c): Promise<BaoTradeActivity> => {
      if (!pubkey) {
        return { totalActiveAmount: 0, activeOrderCount: 0, uniqueMarketCount: 0, orders: [] };
      }

      const relay = nostr.relay(BAO_RELAY_URL);
      const events = await relay.query(
        [{ kinds: [38001], authors: [pubkey], limit: 1000 }],
        { signal: c.signal },
      );

      return aggregateBaoTradeActivity(events);
    },
    enabled: !!pubkey,
    staleTime: 60 * 1000,
  });

  return {
    activity: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
