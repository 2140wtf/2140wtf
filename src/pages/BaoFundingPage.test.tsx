import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BaoFundingPage, { ContributeDialog, ReleaseBreakdown } from './BaoFundingPage';
import type { BaoFundraiser, BaoMilestone, ContributeResult } from '@/lib/baoFundraising';

const mocks = vi.hoisted(() => ({
  contributeMock: vi.fn(),
  fetchFundraisersMock: vi.fn(),
  fetchContributionsMock: vi.fn(),
  fetchFundraiserMock: vi.fn(),
  fetchVerificationStatsMock: vi.fn(),
  fetchVerificationModelsMock: vi.fn(),
  releaseMock: vi.fn(),
  claimMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@/lib/baoFundraising', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/baoFundraising')>();
  return {
    ...actual,
    contributeToFundraiser: mocks.contributeMock,
    fetchFundraisers: mocks.fetchFundraisersMock,
    fetchContributions: mocks.fetchContributionsMock,
    fetchFundraiser: mocks.fetchFundraiserMock,
    fetchVerificationStats: mocks.fetchVerificationStatsMock,
    fetchVerificationModels: mocks.fetchVerificationModelsMock,
    releaseMilestone: mocks.releaseMock,
    claimStream: mocks.claimMock,
  };
});

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'user-pubkey', signer: {} } }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toastMock }),
}));

vi.mock('@/hooks/useAuthor', () => ({
  useAuthor: () => ({ data: undefined }),
}));

// The create dialog needs the Nostr publish stack; it is irrelevant here.
vi.mock('@/components/bao-fund/CreateCampaignDialog', () => ({
  CreateCampaignDialog: () => null,
}));

// Child widgets with their own data dependencies — the page tests assert the
// page's own rendering, not these widgets (they have their own test files).
vi.mock('@/components/bao-fund/MilestoneMarketWidget', () => ({
  MilestoneMarketWidget: () => null,
}));
vi.mock('@/components/bao-fund/AttestationPanel', () => ({
  AttestationPanel: () => null,
}));
vi.mock('@/components/bao-fund/StreamBar', () => ({
  StreamBar: () => null,
}));
vi.mock('@/components/bao-fund/ComputeCreditsTab', () => ({
  ComputeCreditsTab: () => null,
}));

const fundraiserA: BaoFundraiser = {
  id: 'fund-a',
  title: 'Campaign A',
  description: null,
  owner_pubkey: 'owner-a',
  runner_type: 'agent',
  goal_sats: 100_000,
  raised_sats: 0,
  status: 'open',
  settlement_rail: 'lightning',
  network: 'signet',
  created_at: '2026-07-01T00:00:00Z',
};

const fundraiserB: BaoFundraiser = { ...fundraiserA, id: 'fund-b', title: 'Campaign B' };

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Mirrors the page: the dialog stays mounted while the target swaps in/out. */
function ContributeHarness() {
  const [target, setTarget] = useState<BaoFundraiser | null>(null);
  return (
    <>
      <button onClick={() => setTarget(fundraiserA)}>fund A</button>
      <button onClick={() => setTarget(fundraiserB)}>fund B</button>
      <ContributeDialog
        fundraiser={target}
        onOpenChange={(open) => !open && setTarget(null)}
        onContributed={() => {}}
      />
    </>
  );
}

function successResult(): ContributeResult {
  return {
    payment_instructions: { kind: 'lightning', bolt11: 'lnbc1demo' },
    fundraiser: fundraiserA,
    milestones: [],
  };
}

function idempotencyKeyOf(call: number): string {
  return (mocks.contributeMock.mock.calls[call][2] as { idempotencyKey: string }).idempotencyKey;
}

describe('ContributeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('reuses the idempotency key across close/reopen so a retry after an ambiguous failure dedupes server-side', async () => {
    // The request's fate is unknown to the user (timeout) — they close the
    // "Contribution failed" dialog and retry, the exact flow the key exists for.
    mocks.contributeMock.mockRejectedValue(new Error('network timeout'));
    renderWithClient(<ContributeHarness />);

    fireEvent.click(screen.getByText('fund A'));
    fireEvent.click(await screen.findByRole('button', { name: /Contribute 1,000 sats/ }));
    await waitFor(() => expect(mocks.contributeMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('fund A'));
    fireEvent.click(await screen.findByRole('button', { name: /Contribute 1,000 sats/ }));
    await waitFor(() => expect(mocks.contributeMock).toHaveBeenCalledTimes(2));

    expect(idempotencyKeyOf(1)).toBe(idempotencyKeyOf(0));
  });

  it('rotates the idempotency key only after a completed contribution', async () => {
    mocks.contributeMock.mockResolvedValue(successResult());
    renderWithClient(<ContributeHarness />);

    fireEvent.click(screen.getByText('fund A'));
    fireEvent.click(await screen.findByRole('button', { name: /Contribute 1,000 sats/ }));
    await screen.findByText(/DO NOT PAY/);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('fund A'));
    fireEvent.click(await screen.findByRole('button', { name: /Contribute 1,000 sats/ }));
    await waitFor(() => expect(mocks.contributeMock).toHaveBeenCalledTimes(2));

    expect(idempotencyKeyOf(1)).not.toBe(idempotencyKeyOf(0));
  });

  it('does not paint a previous campaign\'s payment instructions when the response lands after the dialog was closed', async () => {
    let resolveContribute!: (value: ContributeResult) => void;
    mocks.contributeMock.mockImplementation(
      () => new Promise<ContributeResult>((resolve) => { resolveContribute = resolve; }),
    );
    renderWithClient(<ContributeHarness />);

    fireEvent.click(screen.getByText('fund A'));
    fireEvent.click(await screen.findByRole('button', { name: /Contribute 1,000 sats/ }));
    await waitFor(() => expect(mocks.contributeMock).toHaveBeenCalledTimes(1));

    // The user dismisses the dialog while the request is in flight…
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // …opens a different campaign…
    fireEvent.click(screen.getByText('fund B'));
    await screen.findByText('Fund: Campaign B');

    // …and only then campaign A's response arrives. Campaign B's dialog must
    // stay on the funding form, not show A's demo payment instructions.
    resolveContribute(successResult());
    await waitFor(() =>
      expect(mocks.toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Contribution recorded (DEMO)' }),
      ),
    );
    expect(screen.queryByText(/DO NOT PAY/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Amount (sats)')).toBeInTheDocument();
  });

  it('shows payment instructions when the response lands while the same campaign is still open', async () => {
    mocks.contributeMock.mockResolvedValue(successResult());
    renderWithClient(<ContributeHarness />);

    fireEvent.click(screen.getByText('fund A'));
    fireEvent.click(await screen.findByRole('button', { name: /Contribute 1,000 sats/ }));

    expect(await screen.findByText(/DO NOT PAY/)).toBeInTheDocument();
  });
});


// ── ReleaseBreakdown ─────────────────────────────────────────────────────────

describe('ReleaseBreakdown', () => {
  afterEach(() => cleanup());

  it('derives the fee from amount − released so the three rows always reconcile', () => {
    // The msats field would ceil to 400 sats; the authoritative ledger numbers
    // say 10,000 − 9,499 = 501 sats. The derived value must win.
    render(
      <ReleaseBreakdown
        info={{ milestone_amount_sats: 10_000, verification_fee_msats: 400_000, released_sats: 9_499 }}
        milestoneAmountSats={10_000}
      />,
    );
    expect(screen.getByText('−501 sats')).toBeInTheDocument();
    expect(screen.getByText('10,000 sats')).toBeInTheDocument();
    expect(screen.getByText('9,499 sats')).toBeInTheDocument();
  });

  it('never renders "−0 sats" when the server omits verification_fee_msats', () => {
    render(
      <ReleaseBreakdown
        info={{ milestone_amount_sats: 10_000, released_sats: 9_500 }}
        milestoneAmountSats={10_000}
      />,
    );
    expect(screen.queryByText('−0 sats')).not.toBeInTheDocument();
    expect(screen.getByText(/deducted per AI verification \(see scoring history\)/)).toBeInTheDocument();
  });
});

// ── ContributeDialog: remaining-to-goal floor ───────────────────────────────

describe('ContributeDialog — overfunded campaign', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('floors the remaining amount at 0 and blocks contributing when the goal is reached', () => {
    const overfunded: BaoFundraiser = { ...fundraiserA, goal_sats: 100_000, raised_sats: 150_000 };
    renderWithClient(
      <ContributeDialog fundraiser={overfunded} onOpenChange={() => {}} onContributed={() => {}} />,
    );

    expect(screen.queryByText(/-50,000 sats to goal/)).not.toBeInTheDocument();
    expect(screen.getByText(/Goal reached — further contributions are disabled\./)).toBeInTheDocument();
    expect(screen.getByText('Goal reached — this campaign is fully funded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Contribute .* sats/ })).not.toBeInTheDocument();
  });
});

// ── Full page: keyboard access, release flow, judge label ───────────────────

const pageFundraiser: BaoFundraiser = {
  ...fundraiserA,
  owner_pubkey: 'user-pubkey',
};

const unlockedMilestone: BaoMilestone = {
  id: 'm_1',
  fundraiser_id: 'fund-a',
  idx: 0,
  title: 'Ship it',
  description: null,
  amount_sats: 10_000,
  status: 'unlocked',
  unlocked_at: '2026-07-01T00:00:00Z',
  released_at: null,
  payout_reference: null,
  market_id: 'market-1',
  market_resolution: 'yes',
};

const verificationRow = (partial: Record<string, unknown>) => ({
  id: 1,
  milestone_id: 'm_1',
  fundraiser_id: 'fund-a',
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

function renderPage(fundraiser: BaoFundraiser = pageFundraiser) {
  mocks.fetchFundraisersMock.mockResolvedValue([fundraiser]);
  mocks.fetchFundraiserMock.mockResolvedValue({
    fundraiser,
    milestones: [unlockedMilestone],
  });
  mocks.fetchVerificationStatsMock.mockResolvedValue({
    total_fees_msats: 0,
    verification_balance_sats: 0,
    verification_debt_sats: 0,
    verifications: [],
  });
  mocks.fetchVerificationModelsMock.mockResolvedValue({ defaultModel: 'moonshotai/kimi-k3', models: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <BaoFundingPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Expand Campaign A's card via its header toggle and wait for the detail. */
async function expandCampaign(name = 'Campaign A') {
  const toggle = await screen.findByRole('button', { name: new RegExp(name) });
  fireEvent.click(toggle);
  await screen.findByText('Milestones — each one a market');
  return toggle;
}

describe('BaoFundingPage — campaign card accessibility', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('toggles expand/collapse from a real button with aria-expanded and aria-controls', async () => {
    renderPage();

    const toggle = await screen.findByRole('button', { name: /Campaign A/ });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();

    fireEvent.click(toggle);
    await screen.findByText('Milestones — each one a market');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(controlsId!)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('BaoFundingPage — progress bar guard', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders 0% funded instead of NaN when the campaign goal is 0', async () => {
    renderPage({ ...pageFundraiser, goal_sats: 0, raised_sats: 500 });
    expect(await screen.findByText('0% funded')).toBeInTheDocument();
  });
});

describe('BaoFundingPage — judge model label', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('labels the last score honestly and sorts attempts client-side', async () => {
    renderPage();
    mocks.fetchVerificationStatsMock.mockResolvedValue({
      total_fees_msats: 0,
      verification_balance_sats: 0,
      verification_debt_sats: 0,
      // Server order cannot be trusted: the NEWER attempt arrives first.
      verifications: [
        verificationRow({ id: 2, attempt: 2, model: 'openai/gpt-x', created_at: '2026-07-02T00:00:00Z' }),
        verificationRow({ id: 1, attempt: 1, model: 'moonshotai/kimi-k3', created_at: '2026-07-01T00:00:00Z' }),
      ],
    });

    await expandCampaign();
    expect(
      await screen.findByText('Last scored by gpt-x · next judge decided by donor votes'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Judge:/)).not.toBeInTheDocument();
  });
});

describe('BaoFundingPage — milestone release', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('requires confirmation, sends an idempotency key, and shows the reconciled fee breakdown', async () => {
    mocks.releaseMock.mockResolvedValue({
      milestone: { ...unlockedMilestone, status: 'released' },
      fundraiser: pageFundraiser,
      milestone_amount_sats: 10_000,
      verification_fee_msats: 400_000,
      released_sats: 9_499,
    });
    renderPage();
    await expandCampaign();

    fireEvent.click(screen.getByRole('button', { name: 'Record demo release · 10,000 sats' }));
    // Nothing fires before the explicit confirmation.
    expect(mocks.releaseMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Release payout (demo)' }));

    await waitFor(() => expect(mocks.releaseMock).toHaveBeenCalledTimes(1));
    const [, fundraiserId, milestoneId, opts] = mocks.releaseMock.mock.calls[0] as [unknown, string, string, { idempotency_key?: string }];
    expect(fundraiserId).toBe('fund-a');
    expect(milestoneId).toBe('m_1');
    expect(opts.idempotency_key).toMatch(/^2140:release:fund-a:m_1:/);

    // Breakdown built in onSuccess — fresh variables + fresh data, derived fee.
    expect(await screen.findByText('−501 sats')).toBeInTheDocument();
    expect(screen.getByText('9,499 sats')).toBeInTheDocument();
  });

  it('reuses the idempotency key when a failed release is retried', async () => {
    mocks.releaseMock
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValue({
        milestone: { ...unlockedMilestone, status: 'released' },
        fundraiser: pageFundraiser,
        milestone_amount_sats: 10_000,
        verification_fee_msats: 500_000,
        released_sats: 9_500,
      });
    renderPage();
    await expandCampaign();

    fireEvent.click(screen.getByRole('button', { name: 'Record demo release · 10,000 sats' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Release payout (demo)' }));
    await waitFor(() => expect(mocks.toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Release failed' }),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Record demo release · 10,000 sats' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Release payout (demo)' }));
    await waitFor(() => expect(mocks.releaseMock).toHaveBeenCalledTimes(2));

    const keyOf = (call: number) =>
      (mocks.releaseMock.mock.calls[call] as [unknown, string, string, { idempotency_key: string }])[3].idempotency_key;
    expect(keyOf(1)).toBe(keyOf(0));
  });
});
