/**
 * Lightning Observatory HTTP API client.
 *
 * lightningobservatory.com sends `X-Frame-Options: DENY`, so the full 3D
 * observatory cannot be iframed into the app. What it does expose is a small
 * JSON API with live network-wide aggregate stats, which we render natively.
 *
 * The API sends no CORS headers, so — like the bao.markets client — we try a
 * same-origin proxied path first (vite dev/preview proxy, or a production
 * host rule forwarding `/lo-api/*` to `https://lightningobservatory.com/api/*`)
 * and fall back to the public host (works if the observatory enables CORS).
 */

export const LO_API_BASE = '/lo-api';
export const LO_PUBLIC_API_BASE = 'https://lightningobservatory.com/api';

export const LIGHTNING_OBSERVATORY_URL = 'https://lightningobservatory.com/';

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
 * Fetch a path from the proxied API first, falling back to the public host
 * when the proxy is missing or returns a non-JSON response (mirrors
 * `baoApiFetch` in baoMarketApi.ts).
 */
export async function loApiFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const proxiedPath = `${LO_API_BASE}${path}`;
  const publicPath = `${LO_PUBLIC_API_BASE}${path}`;

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
    throw new Error(`Lightning Observatory API returned ${res.status}`);
  }

  return res;
}

/** Fetch live network-wide aggregate stats. */
export async function fetchLightningNetworkStats(signal?: AbortSignal): Promise<LightningNetworkStats> {
  const res = await loApiFetch('/network', signal);
  return parseLightningNetworkStats(await res.json());
}
