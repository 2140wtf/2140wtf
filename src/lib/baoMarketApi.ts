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
    // ₿AO Fund milestone markets settle through the fund API — the SMJ
    // service keeps no pool for them (every /smj/:id probe returns 404), so
    // the API's `smj` flag must not route them into parimutuel-odds lookups.
    // Verified live: 18/18 `bao-fund` markets 404 the SMJ endpoint while
    // every other SMJ-flagged market returns 200.
    poolModel:
      api.category.toLowerCase() !== 'bao-fund' && (api.smj || api.pool_model === 'smj')
        ? 'smj'
        : api.pool_model === 'amm'
          ? 'amm'
          : undefined,
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
 * Circuit breaker for the BAO markets API.
 *
 * relay.bao.network/bao-api is a third-party host that periodically goes down
 * or stops sending CORS headers. The markets surface fans out one request per
 * market (positions, sparklines, history), so a single outage used to turn
 * into dozens of simultaneous failing fetches — a console-error storm for
 * users and red smoke tests in CI, every single time.
 *
 * After FAILURE_THRESHOLD failures within WINDOW_MS the circuit opens and
 * every BAO market API call fails fast (no network) for COOLDOWN_MS. When
 * the cooldown expires the circuit half-opens and lets exactly one probe
 * through: success closes it, failure re-trips it for another cooldown.
 * Outages are therefore cheap and silent while they last, and the app
 * recovers automatically the moment the API does.
 */

const FAILURE_THRESHOLD = 3;
const WINDOW_MS = 10_000;
const COOLDOWN_MS = 60_000;

let failures = 0;
let lastFailureAt = 0;
let openUntil: number | null = null;
/** True after the cooldown expires and one probe has been released. */
let probeAllowed = false;

function isCircuitOpen(): boolean {
  if (openUntil === null) return false;
  if (Date.now() >= openUntil) {
    // Cooldown expired — half-open: let exactly one probe through.
    openUntil = null;
    failures = 0;
    probeAllowed = true;
    return false;
  }
  return true;
}

function recordFailure(): void {
  const now = Date.now();
  if (probeAllowed) {
    // The half-open probe failed: re-open immediately for a full cooldown.
    probeAllowed = false;
    failures = 0;
    lastFailureAt = now;
    openUntil = now + COOLDOWN_MS;
    return;
  }
  if (now - lastFailureAt > WINDOW_MS) failures = 0;
  failures += 1;
  lastFailureAt = now;
  if (failures >= FAILURE_THRESHOLD) {
    openUntil = now + COOLDOWN_MS;
  }
}

function recordSuccess(): void {
  failures = 0;
  lastFailureAt = 0;
  openUntil = null;
  probeAllowed = false;
}

/** Reset the breaker state (unit tests; can also be called on logout). */
export function resetBaoApiCircuit(): void {
  failures = 0;
  lastFailureAt = 0;
  openUntil = null;
  probeAllowed = false;
}

/**
 * Fetch a URL from the proxied API first, falling back to the public host
 * when the proxy is missing or returns a non-JSON response (dev server
 * without the proxy configured, etc).
 */
export async function baoApiFetch(path: string, signal?: AbortSignal): Promise<Response> {
  if (isCircuitOpen()) {
    throw new Error('BAO markets API is temporarily unavailable');
  }

  const proxiedPath = `${baoPrimaryApiBase()}${path}`;
  const publicPath = `${BAO_PUBLIC_API_BASE}${path}`;

  let res: Response;
  try {
    try {
      res = await fetch(proxiedPath, { signal });
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok || !contentType.includes('application/json')) {
        res = await fetch(publicPath, { signal });
      }
    } catch {
      res = await fetch(publicPath, { signal });
    }
  } catch {
    recordFailure();
    throw new Error('BAO markets API unreachable');
  }

  if (!res.ok) {
    recordFailure();
    throw new Error(`BAO markets API returned ${res.status}`);
  }

  recordSuccess();
  return res;
}

/**
 * Fetch a path from BOTH the primary and public bases in parallel (when they
 * differ), returning every ok+JSON response. Used for collection endpoints
 * where the local dev API and the public API hold different rows (the local
 * dev DB only has e2e test markets; production has the full catalog).
 */
export async function baoApiFetchAll(path: string, signal?: AbortSignal): Promise<Response[]> {
  if (isCircuitOpen()) return [];

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
  const okResults = results.filter((r): r is Response => r !== null);

  // Collection fetches are tolerant-by-design (empty array), but the breaker
  // still needs to see failures so it can halt the flood on an outage.
  if (okResults.length === 0) {
    recordFailure();
  } else {
    recordSuccess();
  }

  return okResults;
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
