import { describe, expect, it } from 'vitest';

import { withSmjOdds } from './useBaoSmjOdds';

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
