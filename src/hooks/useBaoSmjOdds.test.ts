import { describe, expect, it } from 'vitest';

import { buildSmjLiveMarket, withSmjOdds } from './useBaoSmjOdds';

describe('buildSmjLiveMarket', () => {
  it('uses the funded live pool when the detail endpoint retains its counters', () => {
    expect(buildSmjLiveMarket([
      { id: 'YES', label: 'YES', votes: 1, pool_sats: 300 },
      { id: 'NO', label: 'NO', votes: 1, pool_sats: 100 },
    ])).toEqual({
      odds: { yes: 0.75, no: 0.25 },
      totalPoolSats: 400,
    });
  });

  it('rebuilds settled binary odds from history when live pool counters are zero', () => {
    expect(buildSmjLiveMarket([
      { id: 'NO', label: 'NO', votes: 0, pool_sats: 0 },
      { id: 'YES', label: 'YES', votes: 0, pool_sats: 0 },
    ], [
      { outcome_id: 'YES', amount_sats: 75 },
      { outcome_id: 'NO', amount_sats: 25 },
      { outcome_id: 'unknown', amount_sats: 10_000 },
    ])).toEqual({
      odds: { no: 0.25, yes: 0.75 },
      totalPoolSats: 100,
    });
  });

  it('rebuilds every categorical outcome without inventing unfunded odds', () => {
    expect(buildSmjLiveMarket([
      { id: 'Under 10%', label: 'Under 10%', votes: 0, pool_sats: 0 },
      { id: '10%-20%', label: '10%-20%', votes: 0, pool_sats: 0 },
      { id: '20%-30%', label: '20%-30%', votes: 0, pool_sats: 0 },
    ], [
      { outcome_id: 'Under 10%', amount_sats: 40 },
      { outcome_id: '10%-20%', amount_sats: 35 },
      { outcome_id: '20%-30%', amount_sats: 25 },
    ])).toEqual({
      odds: { 'under 10%': 0.4, '10%-20%': 0.35, '20%-30%': 0.25 },
      totalPoolSats: 100,
    });
  });

  it('returns null for a genuinely unfunded market', () => {
    expect(buildSmjLiveMarket([
      { id: 'YES', label: 'YES', votes: 0, pool_sats: 0 },
      { id: 'NO', label: 'NO', votes: 0, pool_sats: 0 },
    ])).toBeNull();
  });
});

describe('withSmjOdds', () => {
  it('makes API-backed SMJ pool data available for a relay definition', () => {
    const market = {
      marketId: 'market-1',
      oddsAvailable: false,
      outcomes: [
        { label: 'Yes', probability: 0.5 },
        { label: 'No', probability: 0.5 },
      ],
    };

    expect(withSmjOdds(market, {
      'market-1': {
        odds: { yes: 0.25, no: 0.75 },
        totalPoolSats: 25_598,
      },
    })).toEqual({
      ...market,
      oddsAvailable: true,
      totalVolumeSats: 25_598,
      outcomes: [
        { label: 'Yes', probability: 0.25 },
        { label: 'No', probability: 0.75 },
      ],
    });
  });
});
