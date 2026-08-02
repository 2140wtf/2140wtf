import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useUrlSelectedBaoMarket } from './useUrlSelectedBaoMarket';
import type { BaoMarket } from '@/lib/baoMarketParser';

const market = { marketId: 'market-1' } as BaoMarket;

describe('useUrlSelectedBaoMarket', () => {
  it('does not select again when odds hydration rebuilds the same market', () => {
    const selectMarket = vi.fn();
    const { rerender } = renderHook(
      ({ markets, selectedId }) =>
        useUrlSelectedBaoMarket('market-1', markets, selectedId, selectMarket),
      { initialProps: { markets: [market], selectedId: undefined as string | undefined } },
    );

    expect(selectMarket).toHaveBeenCalledOnce();
    rerender({ markets: [{ ...market }], selectedId: 'market-1' });
    expect(selectMarket).toHaveBeenCalledOnce();
  });
});
