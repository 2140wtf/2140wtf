import { useQuery } from '@tanstack/react-query';
import { NRelay1, type NostrEvent } from '@nostrify/nostrify';

import { parseBaoMarket, type BaoMarket, BAO_MARKET_KIND } from '@/lib/baoMarketParser';

const RELAY = 'wss://relay.bao.network';
const API_BASE = '/bao-api/v1';
const PUBLIC_API_BASE = 'https://relay.bao.network/bao-api/v1';
const QUERY_TIMEOUT_MS = 15_000;

interface ApiOutcome {
  id: string;
  label: string;
  price: number;
  volume: number;
}

interface ApiMarket {
  id: string;
  title: string;
  description: string;
  category: string;
  type: string;
  status: string;
  network: string;
  created_at: number;
  end_date: number;
  outcomes: ApiOutcome[];
  total_volume: number;
  trade_count: number;
  nostr_event_id?: string;
  creator_pubkey: string;
}

interface ApiMarketsResponse {
  data: ApiMarket[];
}

function apiMarketToBaoMarket(api: ApiMarket): BaoMarket {
  const id = api.nostr_event_id || api.id;
  const syntheticEvent: NostrEvent = {
    id,
    pubkey: api.creator_pubkey,
    created_at: api.created_at,
    kind: BAO_MARKET_KIND,
    tags: [],
    content: JSON.stringify({
      title: api.title,
      description: api.description,
      outcomes: api.outcomes,
    }),
    sig: '',
  };

  return {
    marketId: api.id,
    title: api.title,
    description: api.description,
    category: api.category.toLowerCase(),
    state: api.status.toLowerCase(),
    type:
      api.type === 'categorical' || api.type === 'scalar'
        ? api.type
        : 'binary',
    endTime: api.end_date,
    createdAt: api.created_at,
    outcomes: api.outcomes.map((o) => ({
      id: o.id,
      label: o.label,
      probability: Number.isFinite(o.price) ? o.price : 0.5,
    })),
    creatorPubkey: api.creator_pubkey,
    rawEvent: syntheticEvent,
  };
}

async function fetchTopApiMarkets(signal: AbortSignal): Promise<ApiMarket[]> {
  const params = new URLSearchParams({
    status: 'active',
    sort: 'volume',
    limit: '20',
  });
  const publicPath = `${PUBLIC_API_BASE}/markets?${params.toString()}`;
  const proxiedPath = `${API_BASE}/markets?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(proxiedPath, { signal });
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.includes('application/json')) {
      res = await fetch(publicPath, { signal });
    }
  } catch {
    res = await fetch(publicPath, { signal });
  }

  if (!res.ok) {
    throw new Error(`BAO markets API returned ${res.status}`);
  }

  const json = (await res.json()) as ApiMarketsResponse;
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
