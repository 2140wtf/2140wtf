import { describe, expect, it } from 'vitest';

import { buildSyntheticPoolHistory, normalizeBaoPriceHistory } from './baoChartData';

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

  it('builds a deterministic demo curve ending at the current pool ratio', () => {
    const first = buildSyntheticPoolHistory(0.48, 'market-id', 0, 100, 200, 10);
    const second = buildSyntheticPoolHistory(0.48, 'market-id', 0, 100, 200, 10);

    expect(first).toEqual(second);
    expect(first).toHaveLength(10);
    expect(first[0]).toEqual({ time: 100, price: 0.5 });
    expect(first.at(-1)).toEqual({ time: 200, price: 0.48 });
    expect(new Set(first.map((point) => point.time))).toHaveLength(10);
  });
});
