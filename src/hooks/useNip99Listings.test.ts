import { describe, expect, it } from 'vitest';

import { clampNip99Category, clampNip99QueryOptions } from './useNip99Listings';

// ── Round 36 adversarial cases ────────────────────────────────────────────────

describe('round 36: nip99 query-option clamps', () => {
  it('defaults to 180-day lookback and 500-event limit', () => {
    expect(clampNip99QueryOptions({})).toEqual({ lookbackDays: 180, limit: 500 });
  });

  it('caps runaway limits at 2000', () => {
    expect(clampNip99QueryOptions({ limit: 100000 }).limit).toBe(2000);
    expect(clampNip99QueryOptions({ limit: 0 }).limit).toBe(1);
    expect(clampNip99QueryOptions({ limit: -7 }).limit).toBe(1);
  });

  it('caps lookback at 10 years and rejects negatives/NaN', () => {
    expect(clampNip99QueryOptions({ lookbackDays: 999999 }).lookbackDays).toBe(3650);
    expect(clampNip99QueryOptions({ lookbackDays: -5 }).lookbackDays).toBe(0);
    expect(clampNip99QueryOptions({ lookbackDays: NaN }).lookbackDays).toBe(180);
    expect(clampNip99QueryOptions({ lookbackDays: Number.POSITIVE_INFINITY }).lookbackDays).toBe(180);
  });

  it('floors fractional options', () => {
    expect(clampNip99QueryOptions({ lookbackDays: 30.9, limit: 99.9 })).toEqual({ lookbackDays: 30, limit: 99 });
  });

  it('lowercases and caps categories at 64 chars', () => {
    expect(clampNip99Category('ART')).toBe('art');
    expect(clampNip99Category('x'.repeat(9000)).length).toBe(64);
  });
});