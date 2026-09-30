// Regression: the completion responses carry the mint's blind signatures for
// the payout. Dropping them (the old shape returned only the milestone
// status) made a settled release/refund unrecoverable - the only way to
// reconstruct the output proofs is to unblind them against the signed swap.
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fundFetch: vi.fn() }));
vi.mock('../fundHttp', () => ({ fundFetch: mocks.fundFetch }));

import { completeEscrowRefund, completeEscrowRelease } from './escrowSwapComplete';
import type { EscrowSwapWire } from './escrowSwapComplete';

const SWAP = { mint: 'https://mint.example.com', inputs: [], outputs: [] } as unknown as EscrowSwapWire;
const SIGS = [
  { amount: 128, C_: '02' + 'ab'.repeat(32) },
  { amount: 40, C_: '02' + 'cd'.repeat(32) },
];

beforeEach(() => mocks.fundFetch.mockReset());

it('release complete returns the mint signatures for the payout unblind', async () => {
  mocks.fundFetch.mockResolvedValue({
    data: { milestone: { status: 'released' }, released_sats: 150, swap_signatures: SIGS },
  });
  const out = await completeEscrowRelease({ signer: {} as never, frId: 'fr_1', milestoneId: 'm1', swap: SWAP });
  expect(out).toEqual({ milestoneStatus: 'released', releasedSats: 150, swapSignatures: SIGS });
});

it('release complete returns null signatures when the API omits them (never a crash)', async () => {
  mocks.fundFetch.mockResolvedValue({
    data: { milestone: { status: 'released' }, released_sats: 150 },
  });
  const out = await completeEscrowRelease({ signer: {} as never, frId: 'fr_1', milestoneId: 'm1', swap: SWAP });
  expect(out.swapSignatures).toBeNull();
});

it('release complete throws on malformed signatures even though the status looked fine', async () => {
  mocks.fundFetch.mockResolvedValue({
    data: { milestone: { status: 'released' }, released_sats: 150, swap_signatures: [{ amount: -1, C_: 'zz' }] },
  });
  await expect(completeEscrowRelease({ signer: {} as never, frId: 'fr_1', milestoneId: 'm1', swap: SWAP }))
    .rejects.toThrow(/malformed swap signature/);
});

it('refund complete returns the refund amount AND the mint signatures', async () => {
  mocks.fundFetch.mockResolvedValue({
    data: { refunded: true, contribution_id: '55', refund_sats: 98, swap_signatures: SIGS },
  });
  const out = await completeEscrowRefund({ signer: {} as never, frId: 'fr_1', contributionId: '55', swap: SWAP });
  expect(out).toEqual({ refundSats: 98, swapSignatures: SIGS });
});

it('refund complete still refuses an unconfirmed payload', async () => {
  mocks.fundFetch.mockResolvedValue({ data: { refunded: false, contribution_id: '55', refund_sats: 98 } });
  await expect(completeEscrowRefund({ signer: {} as never, frId: 'fr_1', contributionId: '55', swap: SWAP }))
    .rejects.toThrow(/NOT refunded/);
});
