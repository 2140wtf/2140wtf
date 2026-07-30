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

/**
 * Fetch real parimutuel odds for one SMJ market: pool share per outcome
 * label (lowercased), computed from live pool_sats. Returns null when the
 * market isn't SMJ or the pool is empty (fresh market — 50/50 stands).
 */
async function fetchSmjOdds(marketId: string): Promise<Record<string, number> | null> {
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
  return Object.keys(odds).length > 0 ? odds : null;
}

/**
 * Live SMJ (parimutuel) odds for the given market ids, keyed by market id.
 * The markets API's outcome.price is a stale default for SMJ pools — the
 * /smj/:id endpoint carries the real pool distribution (e.g. 0/100 after
 * the first bet), so cards and dialogs show actual odds.
 */
export function useBaoSmjOdds(marketIds: string[]): Record<string, Record<string, number>> {
  const results = useQueries({
    queries: marketIds.map((id) => ({
      queryKey: ['bao-smj-odds', id],
      queryFn: () => fetchSmjOdds(id),
      staleTime: 30_000,
      retry: 1,
    })),
  });

  const map: Record<string, Record<string, number>> = {};
  marketIds.forEach((id, i) => {
    const data = results[i]?.data;
    if (data) map[id] = data;
  });
  return map;
}

/** Apply SMJ odds to a market's outcomes (returns the input unchanged when no odds are known). */
export function withSmjOdds<T extends { outcomes: { label: string; probability: number }[] }>(
  market: T,
  oddsMap: Record<string, Record<string, number>>,
): T {
  const odds = oddsMap[(market as { marketId?: string }).marketId ?? ''];
  if (!odds) return market;
  return {
    ...market,
    outcomes: market.outcomes.map((o) => ({
      ...o,
      probability: odds[o.label.toLowerCase()] ?? o.probability,
    })),
  };
}
