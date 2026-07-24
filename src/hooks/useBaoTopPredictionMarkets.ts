import { useQuery } from '@tanstack/react-query';
import { NRelay1 } from '@nostrify/nostrify';

import { parseBaoMarket, type BaoMarket, BAO_MARKET_KIND } from '@/lib/baoMarketParser';
import { apiMarketToBaoMarket, baoApiFetch, type ApiMarket } from '@/lib/baoMarketApi';

const RELAY = 'wss://relay.bao.network';
const QUERY_TIMEOUT_MS = 15_000;

async function fetchTopApiMarkets(signal: AbortSignal): Promise<ApiMarket[]> {
  const params = new URLSearchParams({
    status: 'active',
    sort: 'volume',
    limit: '20',
  });

  const res = await baoApiFetch(`/markets?${params.toString()}`, signal);
  const json = (await res.json()) as { data?: ApiMarket[] };
  const data = Array.isArray(json.data) ? json.data : [];
  return data.filter((m) => m.status?.toLowerCase() === 'active');
}

function isMarketActive(market: BaoMarket, now: number): boolean {
  return market.state === 'active' && (market.endTime <= 0 || market.endTime >= now);
}

async function fetchActiveRelayMarkets(signal: AbortSignal): Promise<BaoMarket[]> {
  const relay = new NRelay1(RELAY);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const events = await relay.query([{ kinds: [BAO_MARKET_KIND], limit: 500 }], {
      signal: controller.signal,
    });

    const seenIds = new Set<string>();
    const byMarket = new Map<string, BaoMarket>();
    const now = Math.floor(Date.now() / 1000);

    for (const event of events) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);

      const parsed = parseBaoMarket(event);
      if (!parsed || !isMarketActive(parsed, now)) continue;

      const key = `${parsed.creatorPubkey}:${parsed.marketId}`;
      const existing = byMarket.get(key);
      if (!existing || parsed.createdAt > existing.createdAt) {
        byMarket.set(key, parsed);
      }
    }

    return Array.from(byMarket.values()).sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    clearTimeout(timeoutId);
    relay.close().catch(() => {});
  }
}

export function useBaoTopPredictionMarkets() {
  return useQuery<BaoMarket[]>({
    queryKey: ['bao-top-prediction-markets'],
    queryFn: async ({ signal }) => {
      try {
        const apiMarkets = await fetchTopApiMarkets(signal);
        if (apiMarkets.length > 0) {
          return apiMarkets.map(apiMarketToBaoMarket);
        }
      } catch (error) {
        console.warn('[useBaoTopPredictionMarkets] API fetch failed, falling back to relay:', error);
      }

      return fetchActiveRelayMarkets(signal);
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
  });
}
