/**
 * Overpass API client for fetching Bitcoin-accepting businesses
 * from OpenStreetMap (the same data source BTC Map uses).
 *
 * Queries elements tagged with currency:XBT=yes within a geographic bbox.
 */

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

export interface OverpassResponse {
  version: number;
  generator: string;
  osm3s: {
    timestamp_osm_base: string;
    timestamp_areas_base: string;
    copyright: string;
  };
  elements: OverpassElement[];
}

export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const OVERPASS_TIMEOUT = (() => {
  const raw = typeof import.meta !== 'undefined' && import.meta.env?.VITE_OVERPASS_TIMEOUT
    ? String(import.meta.env.VITE_OVERPASS_TIMEOUT)
    : '';
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 35_000;
})();

/**
 * Build an Overpass QL query for Bitcoin businesses within a bbox.
 * Queries nodes, ways, and relations tagged with currency:XBT=yes.
 */
function buildQuery(bbox: BBox): string {
  const minLat = Number(bbox.minLat);
  const minLon = Number(bbox.minLon);
  const maxLat = Number(bbox.maxLat);
  const maxLon = Number(bbox.maxLon);
  const b = `${minLat},${minLon},${maxLat},${maxLon}`;
  return `[out:json][timeout:30];
(
  node["currency:XBT"="yes"](${b});
  way["currency:XBT"="yes"](${b});
  relation["currency:XBT"="yes"](${b});
);
out body center;`;
}

/**
 * Fetch Bitcoin businesses from Overpass API within the given bounding box.
 * Returns normalized elements with lat/lon (ways/relations use their center point).
 */
export async function fetchBitcoinBusinesses(bbox: BBox): Promise<OverpassElement[]> {
  if ([bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon].some(v => !Number.isFinite(v))) {
    throw new Error('Invalid bbox: contains non-finite values');
  }
  if (bbox.minLat > bbox.maxLat || bbox.minLon > bbox.maxLon) {
    throw new Error('Invalid bbox: min > max');
  }
  const query = buildQuery(bbox);
  const body = new URLSearchParams({ data: query });

  const isTransientStatus = (status: number) => status >= 500 || status === 429;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const fetchOnce = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT);
    try {
      return await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    let response: Response;
    try {
      response = await fetchOnce();
    } catch (err: unknown) {
      if ((err as Error | undefined)?.name === 'AbortError') {
        lastError = new Error('Overpass API request timed out');
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
      if (attempt === 3) throw lastError;
      await sleep(Math.min(500 * 2 ** (attempt - 1), 3000));
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (isTransientStatus(response.status)) {
        lastError = new Error(`Overpass API ${response.status}: ${text.slice(0, 200)}`);
        if (attempt === 3) throw lastError;
        await sleep(Math.min(500 * 2 ** (attempt - 1), 3000));
        continue;
      }
      throw new Error(`Overpass API ${response.status}: ${text.slice(0, 200)}`);
    }

    const data: OverpassResponse = await response.json();

    // Normalize: ensure every element has lat/lon
    return data.elements
      .map((el) => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) return null;
        return { ...el, lat, lon } as OverpassElement & { lat: number; lon: number };
      })
      .filter((el): el is OverpassElement & { lat: number; lon: number } => el !== null);
  }

  throw lastError ?? new Error('Overpass API request failed');
}

/**
 * Thrown when the bbox is too large (Overpass may time out or return too much data).
 * Caller should zoom in or split the request.
 */
export function isBBoxTooLarge(bbox: BBox): boolean {
  const latSpan = bbox.maxLat - bbox.minLat;
  const lonSpan = bbox.maxLon - bbox.minLon;
  return latSpan > 5 || lonSpan > 5;
}

/**
 * Estimate how many businesses might be in a bbox based on global density.
 * Very rough heuristic to warn before making huge queries.
 */
export function estimateElementCount(bbox: BBox): number {
  const areaDeg2 = (bbox.maxLat - bbox.minLat) * (bbox.maxLon - bbox.minLon);
  // ~0.5 businesses per degree² is a very rough global average
  return Math.round(areaDeg2 * 0.5);
}
