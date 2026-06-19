import { useQuery } from '@tanstack/react-query';

import type { BaoMarket } from '@/lib/baoMarketParser';

export type VolumeRange = '1H' | '1D' | '1W' | '1M' | 'ALL';

export interface VolumeBucket {
  /** Unix timestamp in seconds of the bucket start. */
  time: number;
  /** Sats traded in that bucket. */
  volume: number;
}

export interface VolumeResponse {
  marketId: string;
  range: VolumeRange;
  buckets: VolumeBucket[];
}

const API_BASE = '/v1';
const PUBLIC_API_BASE = 'https://relay.bao.network/bao-api/v1';

function rangeToPeriod(range: VolumeRange): string {
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

function outcomeQueryIds(outcome: BaoMarket['outcomes'][number]): string[] {
  const ids = new Set<string>();

  ids.add(outcome.id);

  // Binary market outcomes are labelled YES/NO; the API expects uppercase IDs.
  if (outcome.label && outcome.label.toUpperCase() !== outcome.id.toUpperCase()) {
    ids.add(outcome.label.toUpperCase());
  }
  if (outcome.id.toUpperCase() !== outcome.id) {
    ids.add(outcome.id.toUpperCase());
  }

  return Array.from(ids);
}

async function fetchOutcomeVolume(
  marketId: string,
  outcomeId: string,
  period: string,
  signal: AbortSignal,
): Promise<ApiPricePoint[]> {
  const params = new URLSearchParams({ period, outcome_id: outcomeId });
  const path = `${API_BASE}/markets/${encodeURIComponent(marketId)}/price-history?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(path, { signal });
  } catch {
    // Fall back to the public Bao API when running outside the hosted/proxied environment.
    const publicPath = `${PUBLIC_API_BASE}/markets/${encodeURIComponent(marketId)}/price-history?${params.toString()}`;
    res = await fetch(publicPath, { signal });
  }

  if (!res.ok) {
    throw new Error(`Volume API returned ${res.status}`);
  }

  const json = (await res.json()) as PriceHistoryApiResponse;
  const prices = json.data?.prices;
  if (!Array.isArray(prices)) {
    throw new Error('Invalid volume response: missing prices array');
  }

  return prices.filter(
    (p): p is ApiPricePoint =>
      typeof p.timestamp === 'number' && typeof p.volume === 'number' && Number.isFinite(p.volume),
  );
}

function aggregateVolume(points: ApiPricePoint[]): VolumeBucket[] {
  const byTime = new Map<number, number>();

  for (const point of points) {
    byTime.set(point.timestamp, (byTime.get(point.timestamp) ?? 0) + point.volume);
  }

  return Array.from(byTime.entries())
    .sort(([a], [b]) => a - b)
    .map(([time, volume]) => ({ time, volume }));
}

export function useBaoMarketVolume(market: BaoMarket | null, range: VolumeRange = 'ALL') {
  return useQuery<VolumeResponse>({
    queryKey: ['bao-market-volume', market?.marketId, range],
    queryFn: async ({ signal }) => {
      if (!market) {
        throw new Error('market is required');
      }

      const period = rangeToPeriod(range);
      const allPoints: ApiPricePoint[] = [];

      await Promise.all(
        market.outcomes.map(async (outcome) => {
          const ids = outcomeQueryIds(outcome);

          for (const id of ids) {
            try {
              const points = await fetchOutcomeVolume(market.marketId, id, period, signal);
              if (points.length > 0) {
                allPoints.push(...points);
                return;
              }
            } catch {
              // Try the next candidate outcome id.
            }
          }
        }),
      );

      return {
        marketId: market.marketId,
        range,
        buckets: aggregateVolume(allPoints),
      };
    },
    enabled: !!market,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
