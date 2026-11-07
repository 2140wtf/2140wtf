import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateBaoMarketDialog, FALLBACK_MARKET_CATEGORIES } from './CreateBaoMarketDialog';
import { isSelectableMarketCategory } from '@/lib/marketCategories';

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  toast: vi.fn(),
  categories: [] as Array<{ slug: string; label: string; count: number; active_count: number }>,
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'user-pubkey', signer: {} } }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: mocks.publish, isPending: false }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/hooks/useBaoPredictionMarkets', () => ({
  useBaoMarketCategories: () => ({ data: mocks.categories }),
}));

describe('CreateBaoMarketDialog categories', () => {
  beforeEach(() => {
    // Exactly what GET /v1/categories serves today: `fundraiser` is the query
    // alias for the angor/fund silo and `bao-fund` has no picker chip at all.
    mocks.categories = [
      { slug: 'fundraiser', label: 'fundraiser', count: 10, active_count: 10 },
      { slug: 'bao-fund', label: 'bao-fund', count: 110, active_count: 110 },
      { slug: 'crypto', label: 'crypto', count: 4, active_count: 4 },
      { slug: 'btc-price', label: 'btc-price', count: 2, active_count: 2 },
    ];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('defaults to the first live catalogue slug without publishing', () => {
    render(<CreateBaoMarketDialog open onOpenChange={vi.fn()} />);

    const category = screen.getByRole('combobox', { name: 'Category' });
    expect(category).toHaveTextContent('crypto');
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('falls back to slugs the live API serves when the catalogue is empty', () => {
    mocks.categories = [];
    render(<CreateBaoMarketDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('crypto');
    expect(FALLBACK_MARKET_CATEGORIES.map((c) => c.value)).toEqual(['crypto', 'btc-price', 'politics-us']);
  });

  it('never treats the fundraiser alias or the fund silo as a creation choice', () => {
    expect(isSelectableMarketCategory('fundraiser')).toBe(false);
    expect(isSelectableMarketCategory('bao-fund')).toBe(false);
    expect(isSelectableMarketCategory('agentic')).toBe(false);
    expect(isSelectableMarketCategory('crypto')).toBe(true);
    expect(isSelectableMarketCategory(undefined)).toBe(false);
  });
});
