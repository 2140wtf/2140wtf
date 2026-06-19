import { describe, expect, it } from 'vitest';
import { encodeGeohash, geohashPrecisionForBounds, getGeohashNeighbors } from './geohash';

describe('encodeGeohash', () => {
  it('encodes the classic geohash example', () => {
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  });

  it('produces shorter hashes for lower precision', () => {
    expect(encodeGeohash(57.64911, 10.40744, 5)).toBe('u4pru');
    expect(encodeGeohash(57.64911, 10.40744, 1)).toBe('u');
  });

  it('returns an empty string for zero precision', () => {
    expect(encodeGeohash(0, 0, 0)).toBe('');
  });

  it('clamps out-of-range coordinates', () => {
    // Far outside normal ranges still produces a deterministic hash.
    expect(encodeGeohash(100, 200, 4)).toHaveLength(4);
  });
});

describe('getGeohashNeighbors', () => {
  it('returns the center cell plus 8 neighbors', () => {
    const neighbors = getGeohashNeighbors('u4pru');
    expect(neighbors).toHaveLength(9);
    expect(neighbors[0]).toBe('u4pru');
    expect(new Set(neighbors).size).toBe(9);
  });

  it('neighbor hashes have the same precision as the input', () => {
    const neighbors = getGeohashNeighbors('u4pruy');
    expect(neighbors.every((n) => n.length === 6)).toBe(true);
  });
});

describe('geohashPrecisionForBounds', () => {
  it('uses precision 6 for small viewport spans', () => {
    expect(geohashPrecisionForBounds(0.05)).toBe(6);
  });

  it('uses precision 5 for medium spans', () => {
    expect(geohashPrecisionForBounds(0.2)).toBe(5);
  });

  it('uses precision 4 for large spans', () => {
    expect(geohashPrecisionForBounds(1.0)).toBe(4);
  });
});
