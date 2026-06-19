/**
 * Minimal geohash encoder + neighbor helper.
 *
 * Only implements what Ditto needs for spatial Nostr queries (Roadstr, etc.):
 * encoding a lat/lon to a geohash string and generating the 3x3 neighbor set
 * around a given hash. No decoding precision beyond bounding-box is exposed.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode latitude/longitude to a geohash of the given precision.
 */
export function encodeGeohash(lat: number, lon: number, precision: number): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let hash = '';

  while (hash.length < precision) {
    if (evenBit) {
      const lonMid = (lonMin + lonMax) / 2;
      if (lon >= lonMid) {
        idx = idx * 2 + 1;
        lonMin = lonMid;
      } else {
        idx = idx * 2;
        lonMax = lonMid;
      }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) {
        idx = idx * 2 + 1;
        latMin = latMid;
      } else {
        idx = idx * 2;
        latMax = latMid;
      }
    }

    evenBit = !evenBit;
    bit += 1;
    if (bit === 5) {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }

  return hash;
}

interface GeohashBounds {
  lat: [number, number];
  lon: [number, number];
}

/**
 * Decode a geohash to its latitude/longitude bounding box.
 */
function decodeBounds(hash: string): GeohashBounds {
  let evenBit = true;
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  for (const char of hash) {
    const idx = BASE32.indexOf(char);
    if (idx < 0) {
      throw new Error(`Invalid geohash character: ${char}`);
    }

    for (let i = 4; i >= 0; i--) {
      const bit = (idx >> i) & 1;
      if (evenBit) {
        const lonMid = (lonMin + lonMax) / 2;
        if (bit === 1) {
          lonMin = lonMid;
        } else {
          lonMax = lonMid;
        }
      } else {
        const latMid = (latMin + latMax) / 2;
        if (bit === 1) {
          latMin = latMid;
        } else {
          latMax = latMid;
        }
      }
      evenBit = !evenBit;
    }
  }

  return { lat: [latMin, latMax], lon: [lonMin, lonMax] };
}

/**
 * Return the neighboring geohash in one cardinal direction.
 *
 * Implemented by decoding the source hash, moving to the adjacent cell's
 * center, and re-encoding. This is simple and sufficient for local queries;
 * it intentionally does not special-case the poles or antimeridian.
 */
function neighbor(hash: string, dLat: number, dLon: number): string {
  const bounds = decodeBounds(hash);
  const latCenter = (bounds.lat[0] + bounds.lat[1]) / 2;
  const lonCenter = (bounds.lon[0] + bounds.lon[1]) / 2;
  const latSpan = bounds.lat[1] - bounds.lat[0];
  const lonSpan = bounds.lon[1] - bounds.lon[0];

  const newLat = latCenter + dLat * latSpan;
  const newLon = lonCenter + dLon * lonSpan;
  return encodeGeohash(newLat, newLon, hash.length);
}

/**
 * Return the center hash plus its 8 surrounding neighbors (3x3 grid).
 * Useful for covering a viewport while avoiding boundary effects.
 */
export function getGeohashNeighbors(hash: string): string[] {
  const n = neighbor(hash, 1, 0);
  const s = neighbor(hash, -1, 0);
  const e = neighbor(hash, 0, 1);
  const w = neighbor(hash, 0, -1);
  const ne = neighbor(n, 0, 1);
  const nw = neighbor(n, 0, -1);
  const se = neighbor(s, 0, 1);
  const sw = neighbor(s, 0, -1);
  return [hash, n, s, e, w, ne, nw, se, sw];
}

/**
 * Pick a geohash precision for a bounding box width in degrees.
 * Approximate cell widths: 4 ≈ 78 km, 5 ≈ 19 km, 6 ≈ 5 km.
 */
export function geohashPrecisionForBounds(degreeSpan: number): number {
  if (degreeSpan < 0.1) return 6;
  if (degreeSpan < 0.5) return 5;
  return 4;
}
