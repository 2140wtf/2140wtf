import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreateBaoMarketDialog, MARKET_CATEGORIES } from './CreateBaoMarketDialog';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), toast: vi.fn() }));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'user-pubkey', signer: {} } }),
}));

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: mocks.publish, isPending: false }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

describe('CreateBaoMarketDialog categories', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses the controlled BAO Markets category catalog without publishing', () => {
    render(<CreateBaoMarketDialog open onOpenChange={vi.fn()} />);

    const category = screen.getByRole('combobox', { name: 'Category' });
    expect(category).toHaveTextContent('Bitcoin');
    expect(MARKET_CATEGORIES.map((option) => option.label)).toEqual([
      'Bitcoin', 'Politics', 'Sports', 'Nostr', 'Angor Markets', 'Culture',
      'Events', 'Climate & Energy', 'Economics', 'Tech & Science', 'BAO', 'Other',
    ]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
