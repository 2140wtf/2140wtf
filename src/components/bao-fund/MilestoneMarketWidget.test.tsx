import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MilestoneMarketWidget } from './MilestoneMarketWidget';
import type { BaoFundraiser, BaoMilestone, BaoMilestoneVerification } from '@/lib/baoFundraising';

const mocks = vi.hoisted(() => ({
  useBaoMarket: vi.fn(),
}));

vi.mock('@/hooks/useBaoMarket', () => ({
  useBaoMarket: (id: string | null | undefined) => mocks.useBaoMarket(id),
}));

// The detail dialog pulls in the whole trading stack; a marker is enough to
// assert when it would open.
vi.mock('@/components/BaoMarketDetailDialog', () => ({
  BaoMarketDetailDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="market-detail-dialog" /> : null,
}));

const milestone = (partial: Partial<BaoMilestone>): BaoMilestone => ({
  id: 'm_1',
  fundraiser_id: 'fr_1',
  idx: 0,
  title: 'Ship the thing',
  description: null,
  amount_sats: 10_000,
  status: 'unlocked',
  unlocked_at: null,
  released_at: null,
  payout_reference: null,
  ...partial,
});

const fundraiser = (partial: Partial<BaoFundraiser>): BaoFundraiser => ({
  id: 'fr_1',
  title: 'Campaign',
  description: null,
  owner_pubkey: 'pk',
  runner_type: 'agent',
  goal_sats: 21_000,
  raised_sats: 10_500,
  status: 'open',
  settlement_rail: 'lightning',
  network: 'demo',
  created_at: '2026-07-01T00:00:00Z',
  ...partial,
});

const verification = (partial: Partial<BaoMilestoneVerification>): BaoMilestoneVerification => ({
  id: 1,
  milestone_id: 'm_1',
  fundraiser_id: 'fr_1',
  attempt: 1,
  model: 'moonshotai/kimi-k3',
  score: 90,
  verdict: 'pass',
  fee_msats: 500_000,
  inference_msats: 300_000,
  operator_msats: 200_000,
  input_tokens: 1000,
  output_tokens: 100,
  cost_msats: 300_000,
  evidence_hash: 'sha256:a',
  rules_hash: 'sha256:b',
  receipt_hash: null,
  nostr_event_id: null,
  job_id: null,
  created_at: '2026-07-01T00:00:00Z',
  ...partial,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MilestoneMarketWidget — progress bar', () => {
  it('renders 0% instead of NaN when the campaign goal is 0', () => {
    mocks.useBaoMarket.mockReturnValue({ data: undefined, isLoading: false });
    render(
      <MilestoneMarketWidget
        milestone={milestone({})}
        fundraiser={fundraiser({ goal_sats: 0, raised_sats: 100 })}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.innerHTML).toContain('translateX(-100%)');
    expect(bar.innerHTML).not.toContain('NaN');
  });
});

describe('MilestoneMarketWidget — fee badge', () => {
  it('labels the badge as a runner fee on payout, not a bare percent', () => {
    mocks.useBaoMarket.mockReturnValue({ data: undefined, isLoading: false });
    render(<MilestoneMarketWidget milestone={milestone({ fee_bps: 214 })} />);
    expect(screen.getByText('2.14% runner fee on payout')).toBeInTheDocument();
  });
});

describe('MilestoneMarketWidget — released milestone', () => {
  it('shows only the recorded AI verification fee, never a client-computed released amount', () => {
    mocks.useBaoMarket.mockReturnValue({ data: undefined, isLoading: false });
    render(
      <MilestoneMarketWidget
        milestone={milestone({ status: 'released' })}
        verification={verification({ fee_msats: 500_000 })}
      />,
    );
    expect(screen.getByText('AI verification fee: 500 sats.')).toBeInTheDocument();
    // 10,000 − 500 = 9,500 computed client-side used to render here.
    expect(screen.queryByText(/Released 9,500 sats/)).not.toBeInTheDocument();
  });
});

describe('MilestoneMarketWidget — market detail dialog', () => {
  const market = {
    id: 'mkt_1',
    title: 'Will it ship?',
    outcomes: [
      { id: 'yes', label: 'Yes', probability: 0.6 },
      { id: 'no', label: 'No', probability: 0.4 },
    ],
    state: 'open',
  };

  it('does not open the dialog when clicked while the market is still loading', () => {
    mocks.useBaoMarket.mockReturnValue({ data: undefined, isLoading: true });
    render(<MilestoneMarketWidget milestone={milestone({ market_id: 'mkt_1' })} />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByTestId('market-detail-dialog')).not.toBeInTheDocument();
  });

  it('opens the dialog only once the market has loaded', () => {
    mocks.useBaoMarket.mockReturnValue({ data: market, isLoading: false });
    render(<MilestoneMarketWidget milestone={milestone({ market_id: 'mkt_1' })} />);

    const button = screen.getByRole('button');
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByTestId('market-detail-dialog')).toBeInTheDocument();
  });
});
