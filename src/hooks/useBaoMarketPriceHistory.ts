import { useQuery } from '@tanstack/react-query';

import type { BaoMarket } from '@/lib/baoMarketParser';

export type PriceHistoryRange = '1H' | '1D' | '1W' | '1M' | 'ALL';

export interface PricePoint {
  /** Unix timestamp in seconds. */
  time: number;
  /** Probability in the range [0, 1]. */
  price: number;
}

interface ApiPricePoint {
  timestamp: number;
  price: number;
  volume: number;
}

interface PriceHistoryApiResponse {
  data: {
    market_id: string;
    outcome_id: string;
    period: string;
    prices: ApiPricePoint[];
  };
  meta?: unknown;
}

const API_BASE = '/v1';
const PUBLIC_API_BASE = 'https://relay.bao.network/bao-api/v1';

function rangeToPeriod(range: PriceHistoryRange): string {
  switch (range) {
    case '1H':
      return '1h';
    case '1D':
      return '24h';
    case '1W':
      return '7d';
    case '1M':
      return '30d';
    case 'ALL':
      return 'all';
  }
}

function normalizePrice(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function outcomeQueryIds(outcome: BaoMarket['outcomes'][number]): string[] {
  const ids: string[] = [];

  function add(id: string) {
    if (id && !ids.includes(id)) ids.push(id);
  }

  add(outcome.id);

  // Try the raw label (used by categorical markets).
  if (outcome.label && outcome.label !== outcome.id) {
    add(outcome.label);
  }

  // Binary market outcomes are labelled YES/NO; the API expects uppercase IDs.
  if (outcome.id.toUpperCase() !== outcome.id) {
    add(outcome.id.toUpperCase());
  }
  if (outcome.label && outcome.label.toUpperCase() !== outcome.label) {
    add(outcome.label.toUpperCase());
  }

  return ids;
}

async function fetchOutcomeHistory(
  marketId: string,
  outcomeId: string,
  period: string,
  signal: AbortSignal,
): Promise<PricePoint[]> {
  const params = new URLSearchParams({ period, outcome_id: outcomeId });
  const path = `${API_BASE}/markets/${encodeURIComponent(marketId)}/price-history?${params.toString()}`;

  const publicPath = `${PUBLIC_API_BASE}/markets/${encodeURIComponent(marketId)}/price-history?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(path, { signal });
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.includes('application/json')) {
      // Fall back to the public Bao API when the same-origin path is not proxied
      // (e.g. a static SPA server returning HTML 200 for unknown routes).
      res = await fetch(publicPath, { signal });
    }
  } catch {
    // Fall back to the public Bao API when running outside the hosted/proxied environment.
    res = await fetch(publicPath, { signal });
  }

  if (!res.ok) {
    throw new Error(`Price history API returned ${res.status}`);
  }

  const json = (await res.json()) as PriceHistoryApiResponse;
  const prices = json.data?.prices;
  if (!Array.isArray(prices)) {
    throw new Error('Invalid price history response: missing prices array');
  }

  return prices
    .filter((p) => typeof p.timestamp === 'number')
    .map((p) => ({
      time: p.timestamp,
      price: normalizePrice(p.price),
    }));
}

export function useBaoMarketPriceHistory(
  market: BaoMarket | null,
  range: PriceHistoryRange = 'ALL',
) {
  return useQuery<Record<string, PricePoint[]>>({
    queryKey: ['bao-market-price-history', market?.marketId, range],
    queryFn: async ({ signal }) => {
      if (!market) return {};

      const period = rangeToPeriod(range);
      const result: Record<string, PricePoint[]> = {};

      await Promise.all(
        market.outcomes.map(async (outcome) => {
          const ids = outcomeQueryIds(outcome);

          for (const id of ids) {
            try {
              const points = await fetchOutcomeHistory(market.marketId, id, period, signal);
              if (points.length > 0) {
                result[outcome.label] = points;
                return;
              }
            } catch {
              // Try the next candidate outcome id.
            }
          }
        }),
      );

      return result;
    },
    enabled: !!market,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
