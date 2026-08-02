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

export const BAO_PUBLIC_API_BASE = 'https://relay.bao.network/bao-api/v1';

/**
 * Primary API base. There is no local API: dev and deployed builds alike talk
 * to the public bao.markets API. Deployed builds try the same-origin proxy
 * first and fall back to the public host inside baoApiFetch; the env var
 * remains as an explicit override.
 */
function baoPrimaryApiBase(): string {
  const fromEnv = (import.meta.env.VITE_BAO_FUNDRAISING_API_URL as string | undefined)?.replace(/\/+$/, '');
  if (fromEnv) return `${fromEnv}/v1`;
  if (import.meta.env.DEV) return BAO_PUBLIC_API_BASE;
  return '/bao-api/v1';
}

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
  end_date: number | null;
  outcomes: ApiOutcome[];
  total_volume: number;
  trade_count: number;
  liquidity?: number;
  nostr_event_id?: string;
  creator_pubkey: string;
  resolution?: string | null;
  pool_model?: string;
  smj?: boolean;
  payment_rails?: string[];
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
    endTime: typeof api.end_date === 'number' && Number.isFinite(api.end_date) ? api.end_date : 0,
    createdAt: api.created_at,
    poolModel: api.smj || api.pool_model === 'smj' ? 'smj' : api.pool_model === 'amm' ? 'amm' : undefined,
    paymentRails: Array.isArray(api.payment_rails) ? api.payment_rails : undefined,
    totalVolumeSats: finiteNonNegative(api.total_volume),
    tradeCount: finiteNonNegative(api.trade_count),
    liquiditySats: finiteNonNegative(api.liquidity),
    outcomes: api.outcomes.map((o) => ({
      id: o.id,
      label: o.label,
      probability: Number.isFinite(o.price) ? o.price : 0.5,
      volumeSats: finiteNonNegative(o.volume),
    })),
    creatorPubkey: api.creator_pubkey,
    resolution: api.resolution ?? null,
    rawEvent: syntheticEvent,
  };
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Fetch a URL from the proxied API first, falling back to the public host
 * when the proxy is missing or returns a non-JSON response (dev server
 * without the proxy configured, etc).
 */
export async function baoApiFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const proxiedPath = `${baoPrimaryApiBase()}${path}`;
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

/**
 * Fetch a path from BOTH the primary and public bases in parallel (when they
 * differ), returning every ok+JSON response. Used for collection endpoints
 * where the local dev API and the public API hold different rows (the local
 * dev DB only has e2e test markets; production has the full catalog).
 */
export async function baoApiFetchAll(path: string, signal?: AbortSignal): Promise<Response[]> {
  const primary = `${baoPrimaryApiBase()}${path}`;
  const publicUrl = `${BAO_PUBLIC_API_BASE}${path}`;

  const tryFetch = async (url: string): Promise<Response | null> => {
    try {
      const res = await fetch(url, { signal });
      const contentType = res.headers.get('content-type') ?? '';
      return res.ok && contentType.includes('application/json') ? res : null;
    } catch {
      return null;
    }
  };

  const urls = primary === publicUrl ? [primary] : [primary, publicUrl];
  const results = await Promise.all(urls.map(tryFetch));
  return results.filter((r): r is Response => r !== null);
}

/** One entry of the API's GET /categories catalog. */
export interface BaoMarketCategory {
  slug: string;
  label: string;
  count: number;
  active_count: number;
}

/**
 * Fetch the market category catalog. Public-API entries win on slug conflicts
 * (they carry the real counts); primary-only slugs are appended.
 */
export async function fetchBaoMarketCategories(signal?: AbortSignal): Promise<BaoMarketCategory[]> {
  const responses = await baoApiFetchAll('/categories', signal);
  const bySlug = new Map<string, BaoMarketCategory>();
  for (const res of [...responses].reverse()) {
    const json = (await res.json()) as { data?: BaoMarketCategory[] };
    for (const c of json.data ?? []) {
      if (!bySlug.has(c.slug)) bySlug.set(c.slug, c);
    }
  }
  return Array.from(bySlug.values());
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
