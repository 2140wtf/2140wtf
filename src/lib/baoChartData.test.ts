import { describe, expect, it } from 'vitest';

import { buildCurrentPoolSnapshot, normalizeBaoPriceHistory } from './baoChartData';

describe('normalizeBaoPriceHistory', () => {
  it('sorts points and keeps the latest value for duplicate seconds', () => {
    expect(normalizeBaoPriceHistory([
      { time: 20, price: 0.4 },
      { time: 10, price: 0.5 },
      { time: 20, price: 0.6 },
    ])).toEqual([
      { time: 10, price: 0.5 },
      { time: 20, price: 0.6 },
    ]);
  });

  it('builds a flat current-pool snapshot without inventing price movement', () => {
    expect(buildCurrentPoolSnapshot(0.48, 100, 200)).toEqual([
      { time: 100, price: 0.48 },
      { time: 200, price: 0.48 },
    ]);
  });
});
