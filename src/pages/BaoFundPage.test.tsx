import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { LayoutStore, LayoutStoreContext } from '@/contexts/LayoutContext';
import { BaoFundPage } from './BaoFundPage';

vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: null }) }));

const mocks = vi.hoisted(() => ({
  cards: [] as unknown[],
  locationState: null as null | { fundraiserId?: string; title?: string },
  pledge: vi.fn(),
  fetchFundraiser: vi.fn(async () => ({ fundraiser: { id: 'fr-1', title: 'Deep', network: 'testnet', owner_pubkey: 'ab', settlement_rail: 'cashu' }, milestones: [] })),
}));

vi.mock('@/baofund/relay/fundFeed', () => ({
  gateStripProp: () => null,
  useFundFeed: () => ({ loading: false, error: null, cards: mocks.cards, source: 'relay', gateViews: new Map(), reload: vi.fn() }),
}));

vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useLocation: () => ({ state: mocks.locationState, pathname: '/bao/fund', search: '', hash: '', key: 't' }),
}));

vi.mock('@/baofund/lib/baoFundraising', () => ({
  fetchFundraiser: mocks.fetchFundraiser,
}));

vi.mock('@/baofund/components/fund/PledgeModal', () => ({
  PledgeModal: (props: { fundraiserId: string; title: string }) => {
    mocks.pledge(props);
    return <div data-testid="pledge-modal" />;
  },
}));

describe('BaoFundPage', () => {
  beforeEach(() => {
    mocks.cards = [];
    mocks.locationState = null;
    mocks.pledge.mockClear();
    mocks.fetchFundraiser.mockClear();
  });

  it('renders the ₿AO Fund shell with the empty-feed state', async () => {
    render(<LayoutStoreContext.Provider value={new LayoutStore()}><TestApp><BaoFundPage /></TestApp></LayoutStoreContext.Provider>);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/AO Fund/);
    expect(screen.getByText(/No open campaigns yet/i)).toBeInTheDocument();
  });

  it('filters campaigns by the chip the create dialog filed them under', async () => {
    const base = {
      description: '',
      pledgedSats: 0,
      goalSats: 1000,
      endTimeSec: Math.floor(Date.now() / 1000) + 86400,
      category: 'bao-fund',
    };
    mocks.cards = [
      { ...base, id: 'fr-research', frId: 'fr-research', title: 'Research campaign', subcategory: 'research' },
      { ...base, id: 'fr-legacy', frId: 'fr-legacy', title: 'Legacy campaign', subcategory: null },
    ];
    render(<LayoutStoreContext.Provider value={new LayoutStore()}><TestApp><BaoFundPage /></TestApp></LayoutStoreContext.Provider>);

    expect(await screen.findByText('Research campaign')).toBeInTheDocument();
    expect(screen.getByText('Legacy campaign')).toBeInTheDocument();

    // The count is on the chip, so an empty category is visible before the
    // click instead of only after it.
    expect(screen.getByRole('button', { name: 'All (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Research (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pets (0)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Research/ }));
    expect(screen.getByText('Research campaign')).toBeInTheDocument();
    expect(screen.queryByText('Legacy campaign')).not.toBeInTheDocument();

    // Creation predating `subcategory` is silo-only; it belongs on Other, not
    // on a chip that can never match.
    fireEvent.click(screen.getByRole('button', { name: /^Other/ }));
    expect(screen.getByText('Legacy campaign')).toBeInTheDocument();
    expect(screen.queryByText('Research campaign')).not.toBeInTheDocument();
    // Filtering does not rewrite the counts: they describe the whole feed.
    expect(screen.getByRole('button', { name: 'Research (1)' })).toBeInTheDocument();
  });

  it('opens the pledge flow from a fund-from-the-room deep link', async () => {
    mocks.locationState = { fundraiserId: 'fr-1', title: 'Deep' };
    render(<LayoutStoreContext.Provider value={new LayoutStore()}><TestApp><BaoFundPage /></TestApp></LayoutStoreContext.Provider>);

    await waitFor(() => expect(mocks.pledge).toHaveBeenCalledWith(expect.objectContaining({ fundraiserId: 'fr-1' })));
    expect(screen.getByTestId('pledge-modal')).toBeInTheDocument();
  });
});
