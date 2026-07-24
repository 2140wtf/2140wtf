import { describe, expect, it } from 'vitest';

import { parseLightningNetworkStats } from './lightningObservatory';

const livePayload = {
  nodeCount: 16835,
  channelCount: 31044,
  edgeCount: 31044,
  totalCapacity: 146666332527,
  avgChannelSize: 4724466.322864322,
  maxChannelSize: 1000000000,
  blockHeight: 959358,
  source: 'live',
};

describe('parseLightningNetworkStats', () => {
  it('parses a live /api/network payload', () => {
    const stats = parseLightningNetworkStats(livePayload);
    expect(stats).toEqual(livePayload);
  });

  it('defaults a missing source to "unknown"', () => {
    const { source: _source, ...rest } = livePayload;
    expect(parseLightningNetworkStats(rest).source).toBe('unknown');
  });

  it('rejects non-object payloads', () => {
    expect(() => parseLightningNetworkStats(null)).toThrow();
    expect(() => parseLightningNetworkStats('{}')).toThrow();
    expect(() => parseLightningNetworkStats([])).toThrow();
  });

  it('rejects payloads with missing or non-numeric fields', () => {
    expect(() => parseLightningNetworkStats({ ...livePayload, nodeCount: undefined })).toThrow(/nodeCount/);
    expect(() => parseLightningNetworkStats({ ...livePayload, totalCapacity: 'lots' })).toThrow(/totalCapacity/);
    expect(() => parseLightningNetworkStats({ ...livePayload, blockHeight: Number.NaN })).toThrow(/blockHeight/);
  });
});
