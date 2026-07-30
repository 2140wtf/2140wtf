import { useQuery } from '@tanstack/react-query';

import type { PricePoint } from '@/hooks/useBaoMarketPriceHistory';

const SMJ_API_BASE = 'https://relay.bao.network/bao-api/v1';

interface SmjBet {
  outcome_id: string;
  amount_sats: number;
  created_at: number;
}

interface SmjHistoryResponse {
  data?: { bets?: SmjBet[] };
}

/**
 * Build a REAL parimutuel odds curve for an SMJ market from its public bet
 * feed: accumulate pool_sats per outcome over time; at each bet, price =
 * pool[outcome] / total_pool. Returns per-outcome-label series keyed by the
 * lowercased label (matching the chart's outcome labels). Empty when there
 * are no bets (or the route isn't deployed).
 */
export function useBaoSmjHistory(marketId: string | undefined, outcomeLabels: string[]) {
  return useQuery<Record<string, PricePoint[]>>({
    queryKey: ['bao-smj-history', marketId, outcomeLabels.join(',')],
    enabled: !!marketId,
    staleTime: 30_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `${SMJ_API_BASE}/smj/${encodeURIComponent(marketId!)}/history`,
        { signal },
      );
      if (!res.ok) return {};
      const json = (await res.json()) as SmjHistoryResponse;
      const bets = json?.data?.bets ?? [];

      // Accumulate pool per outcome over time.
      const labels = outcomeLabels.map((l) => l.toLowerCase());
      const pool = new Map<string, number>(labels.map((l) => [l, 0]));
      const series = new Map<string, PricePoint[]>(labels.map((l) => [l, []]));

      for (const bet of bets) {
        const label = bet.outcome_id.toLowerCase();
        if (pool.has(label)) {
          pool.set(label, (pool.get(label) ?? 0) + bet.amount_sats);
        }
        const total = [...pool.values()].reduce((a, b) => a + b, 0);
        if (total <= 0) continue;
        for (const [l, sats] of pool) {
          series.get(l)!.push({ time: bet.created_at, price: sats / total });
        }
      }

      return Object.fromEntries(series);
    },
  });
}
