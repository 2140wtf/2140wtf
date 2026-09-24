import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { BaoFundPage } from './BaoFundPage';

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null }),
}));

const reload = vi.fn();
vi.mock('@/baofund/relay/fundFeed', () => ({
  gateStripProp: () => null,
  useFundFeed: () => ({
    loading: false,
    error: null,
    cards: [],
    source: 'offline',
    gateViews: new Map(),
    reload,
  }),
}));

describe('BaoFundPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the ₿AO Fund shell with the empty-feed state', async () => {
    render(
      <TestApp>
        <BaoFundPage />
      </TestApp>,
    );

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/AO Fund/);
    expect(screen.getByText(/No open campaigns yet/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /create campaign/i }).length).toBeGreaterThan(0);
  });
});
