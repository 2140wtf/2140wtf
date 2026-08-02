import { describe, expect, it } from 'vitest';

import { normalizeBaoPriceHistory } from './baoChartData';

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
});
