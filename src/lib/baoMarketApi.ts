/**
 * Shared bao.markets HTTP API client bits.
 *
 * The prediction-market hooks talk to the same REST surface in two places
 * (proxied path first, public host as fallback). The ApiMarket wire type and
 * the ApiMarket -> BaoMarket mapper used to be copy-pasted between
 * useBaoPredictionMarkets and useBaoTopPredictionMarkets; they live here now,
 * together with fetchBaoMarketById for single-market lookups (e.g. ₿AO Fund
 * milestone markets).
 */

import type { NostrEvent } from '@nostrify/nostrify';

import { type BaoMarket, BAO_MARKET_KIND } from '@/lib/baoMarketParser';

export const BAO_API_BASE = '/bao-api/v1';
export const BAO_PUBLIC_API_BASE = 'https://relay.bao.network/bao-api/v1';

export interface ApiOutcome {
  id: string;
  label: string;
  price: number;
  volume: number;
}

export interface ApiMarket {
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
  resolution?: string | null;
}

export interface ApiMarketsResponse {
  data: ApiMarket[];
}

export function apiMarketToBaoMarket(api: ApiMarket): BaoMarket {
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
    resolution: api.resolution ?? null,
    rawEvent: syntheticEvent,
  };
}

/**
 * Fetch a URL from the proxied API first, falling back to the public host
 * when the proxy is missing or returns a non-JSON response (dev server
 * without the proxy configured, etc).
 */
export async function baoApiFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const proxiedPath = `${BAO_API_BASE}${path}`;
  const publicPath = `${BAO_PUBLIC_API_BASE}${path}`;

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

  return res;
}

/** Fetch a single market by id (e.g. a ₿AO Fund milestone market). */
export async function fetchBaoMarketById(marketId: string, signal?: AbortSignal): Promise<BaoMarket> {
  const res = await baoApiFetch(`/markets/${encodeURIComponent(marketId)}`, signal);
  const json = (await res.json()) as { data?: ApiMarket };
  if (!json.data) {
    throw new Error('market not found');
  }
  return apiMarketToBaoMarket(json.data);
}
