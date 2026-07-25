/**
 * Lightning Observatory HTTP API client.
 *
 * lightningobservatory.com sends `X-Frame-Options: DENY` and no CORS headers.
 * The bao-lo-proxy Cloudflare Worker (LO_PROXY_URL) strips those, so the full
 * 3D observatory is iframed at /lightning-observatory/full and the JSON API is
 * fetched through the proxy when no same-origin proxy exists.
 *
 * Fetch order: same-origin `/lo-api/*` (vite dev/preview proxy or a production
 * host rule) → worker proxy → public host (works if CORS is ever enabled).
 */

export const LO_API_BASE = '/lo-api';
export const LO_PUBLIC_API_BASE = 'https://lightningobservatory.com/api';

export const LIGHTNING_OBSERVATORY_URL = 'https://lightningobservatory.com/';

/** Origin of the bao-lo-proxy Cloudflare Worker (bao.markets repo,
 * observatory-proxy-worker). The proxy strips the observatory's
 * X-Frame-Options/frame-ancestors so the full 3D view can be iframed, adds
 * CORS headers to the JSON API, and proxies the live WebSocket feed.
 * Override with VITE_LO_PROXY_URL (e.g. for a locally running wrangler dev). */
export const LO_PROXY_URL: string =
  (import.meta.env.VITE_LO_PROXY_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://bao-lo-proxy.baocommunity.workers.dev';

/** Live network-wide aggregate stats from `GET /api/network`. */
export interface LightningNetworkStats {
  nodeCount: number;
  channelCount: number;
  edgeCount: number;
  /** Total public channel capacity, in sats. */
  totalCapacity: number;
  /** Average channel size, in sats. */
  avgChannelSize: number;
  /** Largest channel size, in sats. */
  maxChannelSize: number;
  blockHeight: number;
  /** Provenance reported by the observatory, e.g. "live". */
  source: string;
}

export function parseLightningNetworkStats(json: unknown): LightningNetworkStats {
  if (typeof json !== 'object' || json === null) {
    throw new Error('unexpected observatory response');
  }
  const j = json as Record<string, unknown>;
  const nums = ['nodeCount', 'channelCount', 'edgeCount', 'totalCapacity', 'avgChannelSize', 'maxChannelSize', 'blockHeight'] as const;
  for (const key of nums) {
    if (typeof j[key] !== 'number' || !Number.isFinite(j[key] as number)) {
      throw new Error(`observatory response missing numeric field "${key}"`);
    }
  }
  return {
    nodeCount: j.nodeCount as number,
    channelCount: j.channelCount as number,
    edgeCount: j.edgeCount as number,
    totalCapacity: j.totalCapacity as number,
    avgChannelSize: j.avgChannelSize as number,
    maxChannelSize: j.maxChannelSize as number,
    blockHeight: j.blockHeight as number,
    source: typeof j.source === 'string' ? j.source : 'unknown',
  };
}

/**
 * Fetch a path from the proxied API first, falling back to the CORS-enabled
 * bao-lo-proxy worker and then the public host (works if the observatory
 * enables CORS). Mirrors `baoApiFetch` in baoMarketApi.ts.
 */
export async function loApiFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const candidates = [
    `${LO_API_BASE}${path}`,
    `${LO_PROXY_URL}/api${path}`,
    `${LO_PUBLIC_API_BASE}${path}`,
  ];

  let res: Response | null = null;
  for (const url of candidates) {
    try {
      const attempt = await fetch(url, { signal });
      const contentType = attempt.headers.get('content-type') ?? '';
      if (attempt.ok && contentType.includes('application/json')) {
        res = attempt;
        break;
      }
    } catch {
      // try the next candidate
    }
  }

  if (!res || !res.ok) {
    throw new Error(`Lightning Observatory API returned ${res?.status ?? 'no response'}`);
  }

  return res;
}

/** Fetch live network-wide aggregate stats. */
export async function fetchLightningNetworkStats(signal?: AbortSignal): Promise<LightningNetworkStats> {
  const res = await loApiFetch('/network', signal);
  return parseLightningNetworkStats(await res.json());
}
