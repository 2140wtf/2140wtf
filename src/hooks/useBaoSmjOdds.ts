import { useQueries } from '@tanstack/react-query';

const SMJ_API_BASE = 'https://relay.bao.network/bao-api/v1';

interface SmjOption {
  id: string;
  label: string;
  votes: number;
  pool_sats: number;
}

interface SmjDetailResponse {
  data?: {
    options?: SmjOption[];
    total_pool?: number;
  };
}

export interface SmjLiveMarket {
  odds: Record<string, number>;
  totalPoolSats: number;
}

/**
 * Fetch real parimutuel odds for one SMJ market: pool share per outcome
 * label (lowercased), computed from live pool_sats. Returns null when the
 * market isn't SMJ or the pool is empty (fresh market — 50/50 stands).
 */
async function fetchSmjOdds(marketId: string): Promise<SmjLiveMarket | null> {
  const res = await fetch(`${SMJ_API_BASE}/smj/${encodeURIComponent(marketId)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as SmjDetailResponse;
  const options = json?.data?.options;
  const total = json?.data?.total_pool ?? 0;
  if (!Array.isArray(options) || total <= 0) return null;

  const odds: Record<string, number> = {};
  for (const opt of options) {
    if (opt.label) odds[opt.label.toLowerCase()] = opt.pool_sats / total;
  }
  return Object.keys(odds).length > 0
    ? {
        odds,
        totalPoolSats: total,
      }
    : null;
}

/**
 * Live SMJ (parimutuel) odds for the given market ids, keyed by market id.
 * The markets API's outcome.price is a stale default for SMJ pools — the
 * /smj/:id endpoint carries the real pool distribution (e.g. 0/100 after
 * the first bet), so cards and dialogs show actual odds.
 */
export function useBaoSmjOdds(marketIds: string[]): Record<string, SmjLiveMarket> {
  const results = useQueries({
    queries: marketIds.map((id) => ({
      queryKey: ['bao-smj-odds', id],
      queryFn: () => fetchSmjOdds(id),
      staleTime: 30_000,
      retry: 1,
    })),
  });

  const map: Record<string, SmjLiveMarket> = {};
  marketIds.forEach((id, i) => {
    const data = results[i]?.data;
    if (data) map[id] = data;
  });
  return map;
}

/** Apply SMJ odds to a market's outcomes (returns the input unchanged when no odds are known). */
export function withSmjOdds<T extends {
  marketId?: string;
  outcomes: { label: string; probability: number }[];
  oddsAvailable?: boolean;
  totalVolumeSats?: number;
  tradeCount?: number;
}>(
  market: T,
  liveMarkets: Record<string, SmjLiveMarket>,
): T {
  const live = liveMarkets[market.marketId ?? ''];
  if (!live) return market;
  return {
    ...market,
    oddsAvailable: true,
    totalVolumeSats: live.totalPoolSats,
    outcomes: market.outcomes.map((o) => ({
      ...o,
      probability: live.odds[o.label.toLowerCase()] ?? o.probability,
    })),
  };
}
