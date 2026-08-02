import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchMiniMarketHistory } from '@/lib/baoMiniHistory';
import type { BaoMarket } from '@/lib/baoMarketParser';

function market(poolModel: BaoMarket['poolModel']): Pick<BaoMarket, 'marketId' | 'poolModel' | 'outcomes'> {
  return {
    marketId: 'market-1',
    poolModel,
    outcomes: [
      { id: 'YES', label: 'Yes', probability: 0.5 },
      { id: 'NO', label: 'No', probability: 0.5 },
    ],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('fetchMiniMarketHistory', () => {
  it('requests one canonical API outcome and preserves real history', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { prices: [{ timestamp: 10, price: 0.25 }, { timestamp: 20, price: 0.75 }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(fetchMiniMarketHistory(market('amm'))).resolves.toEqual([
      { time: 10, price: 0.25 },
      { time: 20, price: 0.75 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('outcome_id=YES');
  });

  it('derives a real SMJ pool-share curve from public bets', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: { bets: [
        { outcome_id: 'YES', amount_sats: 100, created_at: 10 },
        { outcome_id: 'NO', amount_sats: 100, created_at: 20 },
      ] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(fetchMiniMarketHistory(market('smj'))).resolves.toEqual([
      { time: 10, price: 1 },
      { time: 20, price: 0.5 },
    ]);
  });
});
