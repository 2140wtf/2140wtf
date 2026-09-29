/**
 * Demo-universe pledge path: claim demo sats when short, then settle
 * instantly with the ledger transfer (no escrow artifact, no faucet URL).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claimDemoSats = vi.fn();
const demoFundedRail = vi.fn();
const sendFundraiserContribution = vi.fn();

vi.mock('../../lib/demoFaucet', () => ({
  claimDemoSats: (...args: unknown[]) => claimDemoSats(...args),
  demoFundedRail: (...args: unknown[]) => demoFundedRail(...args),
}));
vi.mock('../../lib/fundNetwork', () => ({
  isDemoNetwork: () => true,
}));
vi.mock('../../lib/baoFundraising', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/baoFundraising')>();
  return { ...original, sendFundraiserContribution: (...args: unknown[]) => sendFundraiserContribution(...args) };
});

import { submitPledge, type PledgeDeps, type PledgeRequest } from './pledgeFlow';

const deps = { signer: { signEvent: async (e: unknown) => e }, pubkey: 'ab'.repeat(32) } as unknown as PledgeDeps;
const req: PledgeRequest = {
  fundraiserId: 'fr_demo',
  amountSats: 1_000,
  rail: 'cashu',
  idempotencyKey: 'pledge-1',
};

beforeEach(() => {
  claimDemoSats.mockReset();
  demoFundedRail.mockReset();
  sendFundraiserContribution.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe('submitPledge (demo universe)', () => {
  it('settles instantly from an already-funded ledger rail', async () => {
    demoFundedRail.mockResolvedValue({ rail: 'ecash', balanceSats: 2_000 });
    sendFundraiserContribution.mockResolvedValue({ balanceSats: 1_000 });

    const res = await submitPledge(deps, req);
    expect(res.ok).toBe(true);
    expect(res.claimed).toBe(0);
    expect(res.message).toContain('demo sats');
    expect(claimDemoSats).not.toHaveBeenCalled();
    expect(sendFundraiserContribution).toHaveBeenCalledWith(deps.signer, 'fr_demo', {
      rail: 'ecash',
      amountSats: 1_000,
      idempotencyKey: 'pledge-1',
    });
  });

  it('claims from the faucet when short, then sends', async () => {
    demoFundedRail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ rail: 'cashu', balanceSats: 5_000 });
    claimDemoSats.mockResolvedValue({ rail: 'lightning', status: 'completed', claimedSats: 5_000 });
    sendFundraiserContribution.mockResolvedValue({});

    const res = await submitPledge(deps, req);
    expect(res.ok).toBe(true);
    expect(res.claimed).toBe(5_000);
    expect(claimDemoSats).toHaveBeenCalledTimes(1);
    expect(claimDemoSats).toHaveBeenCalledWith(deps.signer, { amountSats: 1_000, rails: ['lightning', 'ecash', 'cashu'] });
    expect(sendFundraiserContribution).toHaveBeenCalledTimes(1);
  });

  it('fails with the faucet reason when the claim does not fund the rail', async () => {
    demoFundedRail.mockResolvedValue(null);
    claimDemoSats.mockResolvedValue({ rail: 'ecash', status: 'failed', claimedSats: 0, message: 'Fedimint claim failed' });

    const res = await submitPledge(deps, req);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Fedimint claim failed');
    expect(sendFundraiserContribution).not.toHaveBeenCalled();
  });

  it('rejects a zero amount without touching the network', async () => {
    const res = await submitPledge(deps, { ...req, amountSats: 0 });
    expect(res.ok).toBe(false);
    expect(demoFundedRail).not.toHaveBeenCalled();
  });
});
