import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestApp } from '@/test/TestApp';
import { BaoCourtPage } from './BaoCourtPage';

vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: null }) }));

vi.mock('@/baofund/relay/fundFeed', () => ({
  useFundFeed: () => ({ loading: false, error: null, cards: [], source: 'offline', gateViews: new Map(), reload: vi.fn() }),
}));

const panelSpy = vi.fn();
vi.mock('@/baofund/court/CourtPanel', () => ({
  CourtPanel: (props: { myPubkey: string | null; relayUrl: string }) => {
    panelSpy(props);
    return <div data-testid="court-panel" />;
  },
}));

describe('BaoCourtPage', () => {
  it('renders the FROST court shell and passes the fund relay', async () => {
    render(
      <TestApp>
        <BaoCourtPage />
      </TestApp>,
    );

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/AO Court/);
    expect(screen.getByTestId('court-panel')).toBeInTheDocument();
    expect(panelSpy).toHaveBeenCalledWith(expect.objectContaining({ relayUrl: expect.stringContaining('relay.bao.fund') }));
  });
});
