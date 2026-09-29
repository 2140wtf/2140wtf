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

interface SmjBet {
  outcome_id: string;
  amount_sats: number;
}

interface SmjHistoryResponse {
  data?: {
    bets?: SmjBet[];
  };
}

export interface SmjLiveMarket {
  odds: Record<string, number>;
  totalPoolSats: number;
}

/**
 * Derive the current parimutuel pool from the detail response, or rebuild it
 * from the immutable bet history after a settled market's live counters have
 * been cleared. Only known outcomes and finite positive bets are counted.
 */
export function buildSmjLiveMarket(
  options: SmjOption[],
  bets: SmjBet[] = [],
): SmjLiveMarket | null {
  if (options.length < 2) return null;

  const labelById = new Map<string, string>();
  const pools = new Map<string, number>();
  for (const option of options) {
    const id = option.id.trim().toLowerCase();
    const label = option.label.trim().toLowerCase();
    if (!id || !label || labelById.has(id)) continue;
    labelById.set(id, label);
    pools.set(id, Number.isFinite(option.pool_sats) && option.pool_sats > 0 ? option.pool_sats : 0);
  }
  if (pools.size < 2) return null;

  let total = [...pools.values()].reduce((sum, sats) => sum + sats, 0);
  if (total <= 0) {
    for (const bet of bets) {
      const id = typeof bet.outcome_id === 'string' ? bet.outcome_id.trim().toLowerCase() : '';
      if (!pools.has(id) || !Number.isFinite(bet.amount_sats) || bet.amount_sats <= 0) continue;
      pools.set(id, (pools.get(id) ?? 0) + bet.amount_sats);
    }
    total = [...pools.values()].reduce((sum, sats) => sum + sats, 0);
  }
  if (total <= 0) return null;

  const odds: Record<string, number> = {};
  for (const [id, sats] of pools) {
    const label = labelById.get(id);
    if (label) odds[label] = sats / total;
  }
  return Object.keys(odds).length >= 2 ? { odds, totalPoolSats: total } : null;
}

/**
 * Fetch real parimutuel odds for one SMJ market: pool share per outcome
 * label (lowercased), computed from live pool_sats. Settled markets can clear
 * those counters while retaining their public bets, so history is the honest
 * fallback. Returns null only when neither source contains a funded pool.
 */
async function fetchSmjOdds(marketId: string, signal?: AbortSignal): Promise<SmjLiveMarket | null> {
  const encodedId = encodeURIComponent(marketId);
  const res = await fetch(`${SMJ_API_BASE}/smj/${encodedId}`, { signal });
  if (!res.ok) return null;
  const json = (await res.json()) as SmjDetailResponse;
  const options = json?.data?.options;
  if (!Array.isArray(options)) return null;

  const live = buildSmjLiveMarket(options);
  if (live) return live;

  const historyRes = await fetch(`${SMJ_API_BASE}/smj/${encodedId}/history`, { signal });
  if (!historyRes.ok) return null;
  const history = (await historyRes.json()) as SmjHistoryResponse;
  return buildSmjLiveMarket(options, Array.isArray(history.data?.bets) ? history.data.bets : []);
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
      queryFn: ({ signal }) => fetchSmjOdds(id, signal),
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
