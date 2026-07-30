import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContributeDialog } from './BaoFundingPage';
import type { BaoFundraiser, ContributeResult } from '@/lib/baoFundraising';

const mocks = vi.hoisted(() => ({
  contributeMock: vi.fn(),
  fetchFundraisersMock: vi.fn(),
  fetchContributionsMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('@/lib/baoFundraising', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/baoFundraising')>();
  return {
    ...actual,
    contributeToFundraiser: mocks.contributeMock,
    fetchFundraisers: mocks.fetchFundraisersMock,
    fetchContributions: mocks.fetchContributionsMock,
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

