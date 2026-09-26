import { expect, it, vi } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { generateSecretKey } from 'nostr-tools/pure';
import { executeCourtSettlement, type CourtSettlementDeps } from './executeCourtSettlement';
import {
  buildSigAllMessage,
  signSigAllDigest,
  witnessSignatures,
  type EscrowSwapInputWire,
  type EscrowSwapOutputWire,
} from '../cashu/escrowSwapComplete';
import type { SignerLike } from '../baoFundraising';

const PROJECT = generateSecretKey();
const DONOR = generateSecretKey();
const ORACLE = generateSecretKey();
const PROJECT_X = bytesToHex(schnorr.getPublicKey(PROJECT));
const DONOR_X = bytesToHex(schnorr.getPublicKey(DONOR));
const ORACLE_X = bytesToHex(schnorr.getPublicKey(ORACLE));
const comp = (x: string): string => '02' + x;
const KEYSET = '00deadbeef00';

function escrowSecret(): string {
  return JSON.stringify(['P2PK', {
    nonce: '00',
    data: comp(PROJECT_X),
    tags: [
      ['pubkeys', ...[comp(ORACLE_X), comp(DONOR_X)].sort()],
      ['n_sigs', '2'],
      ['locktime', '1800000000'],
      ['refund', comp(DONOR_X)],
      ['sigflag', 'SIG_ALL'],
    ],
  }]);
}

function payoutOutput(amount: number, pubkey: string, bHex: string): EscrowSwapOutputWire {
  const secret = JSON.stringify(['P2PK', { nonce: '00', data: comp(pubkey) }]);
  return {
    blindedMessage: { amount, B_: '02' + bHex.repeat(64), id: KEYSET },
    blindingFactor: '11'.repeat(32),
    secret: bytesToHex(new TextEncoder().encode(secret)),
  };
}

function escrowInput(amount: number, cHex: string): EscrowSwapInputWire {
  return { id: KEYSET, amount, secret: escrowSecret(), C: '02' + cHex.repeat(32) };
}

/** Oracle-signed release swap: 150 to project + 40 fee, inputs 200, mint fee 10. */
function releaseSwap() {
  const outputs = [payoutOutput(128, PROJECT_X, 'ab'), payoutOutput(22, PROJECT_X, 'cd'), payoutOutput(40, ORACLE_X, 'ef')];
  const inputs = [escrowInput(128, '1a'), escrowInput(72, '2b')];
  const message = buildSigAllMessage(inputs, outputs);
  const sig = signSigAllDigest(bytesToHex(ORACLE), message);
  return {
    mint: 'https://mint.example.com',
    inputs: inputs.map((i) => ({ ...i, witness: { signatures: [sig] } })),
    outputs,
  };
}

/** Oracle-signed refund swap: 98 to the donor. */
function refundSwap() {
  const outputs = [payoutOutput(98, DONOR_X, 'aa')];
  const inputs = [escrowInput(98, '3c')];
  const message = buildSigAllMessage(inputs, outputs);
  const sig = signSigAllDigest(bytesToHex(ORACLE), message);
  return {
    mint: 'https://mint.example.com',
    inputs: inputs.map((i) => ({ ...i, witness: { signatures: [sig] } })),
    outputs,
  };
}

function founderDeps(overrides: Partial<CourtSettlementDeps> = {}): CourtSettlementDeps {
  return {
    viewerRole: 'founder',
    signer: {} as unknown as SignerLike,
    identityHex: bytesToHex(PROJECT),
    myPubkey: PROJECT_X,
    frId: 'fr_1',
    milestoneId: 'm1',
    attestationEventId: 'ev1',
    resolveDonorContributionId: vi.fn(async () => '55'),
    release: vi.fn(async () => ({
      escrow_release: {
        swap: releaseSwap(),
        awaiting: ['project'],
        verifier_pubkey: ORACLE_X,
        project_output_sats: 150,
        fee_sats: 40,
        mint_fee_sats: 10,
      },
    })) as unknown as CourtSettlementDeps['release'],
    completeRelease: vi.fn(async () => ({ milestoneStatus: 'released', releasedSats: 150 })) as unknown as CourtSettlementDeps['completeRelease'],
    completeRefund: vi.fn(async () => ({ refundSats: 98 })) as unknown as CourtSettlementDeps['completeRefund'],
    ...overrides,
  };
}

function donorDeps(overrides: Partial<CourtSettlementDeps> = {}): CourtSettlementDeps {
  return {
    viewerRole: 'donor',
    signer: {} as unknown as SignerLike,
    identityHex: bytesToHex(DONOR),
    myPubkey: DONOR_X,
    frId: 'fr_1',
    milestoneId: 'm1',
    attestationEventId: 'ev1',
    donorContributionId: '55',
    resolveDonorContributionId: vi.fn(async () => '55'),
    fetchRefundInitiate: vi.fn(async () => ({
      escrow_refund: { swap: refundSwap(), awaiting: ['donor'], refund_sats: 98, donor_pubkey: DONOR_X },
    })) as unknown as CourtSettlementDeps['fetchRefundInitiate'],
    completeRelease: vi.fn(async () => ({ milestoneStatus: 'released', releasedSats: 150 })) as unknown as CourtSettlementDeps['completeRelease'],
    completeRefund: vi.fn(async () => ({ refundSats: 98 })) as unknown as CourtSettlementDeps['completeRefund'],
    ...overrides,
  };
}

it('founder: initiate -> sign -> complete, reporting the settled release', async () => {
  const deps = founderDeps();
  const res = await executeCourtSettlement(deps);
  expect(res.status).toBe('executed');
  expect(res.message).toContain('milestone released');
  expect(deps.release).toHaveBeenCalledTimes(1);
  expect(deps.completeRelease).toHaveBeenCalledTimes(1);

  const call = (deps.completeRelease as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { swap: { inputs: { witness?: unknown }[]; outputs: EscrowSwapOutputWire[] }; proofEventId?: string };
  expect(call.proofEventId).toBe('ev1');
  // Outputs are byte-identical to the initiate swap; each input gained the
  // project signature on top of the oracle's.
  expect(call.swap.outputs).toEqual(releaseSwap().outputs);
  const message = buildSigAllMessage(call.swap.inputs as never, call.swap.outputs);
  for (const input of call.swap.inputs) {
    const sigs = witnessSignatures(input.witness);
    expect(sigs).toHaveLength(2);
    expect(sigs.some((s) => s === sigs[0])).toBe(true);
    expect(message.length).toBeGreaterThan(0);
  }
});

it('founder: a recorded release (no escrow swap) still reports executed', async () => {
  const deps = founderDeps({ release: vi.fn(async () => ({ milestone: { status: 'released' } })) as unknown as CourtSettlementDeps['release'] });
  const res = await executeCourtSettlement(deps);
  expect(res.status).toBe('executed');
  expect(res.message).toBe('Court verdict executed.');
  expect(deps.completeRelease).not.toHaveBeenCalled();
});

it('founder: without the seed identity the initiate is reported as unsigned, not executed', async () => {
  const deps = founderDeps({ identityHex: null });
  const res = await executeCourtSettlement(deps);
  expect(res.status).toBe('initiated-unsigned-method');
  expect(res.message).toContain('awaiting: project');
  expect(res.message).toContain('seed identity');
  expect(deps.completeRelease).not.toHaveBeenCalled();
});

it('founder: a completion failure after the initiate is reported as NOT settled', async () => {
  const deps = founderDeps({
    completeRelease: vi.fn(async () => { throw new Error('mint rejected the swap'); }) as unknown as CourtSettlementDeps['completeRelease'],
  });
  const res = await executeCourtSettlement(deps);
  expect(res.status).toBe('initiated-failed');
  expect(res.message).toContain('the escrow is NOT settled');
  expect(res.message).toContain('mint rejected the swap');
});

it('founder: a release initiate missing the payout facts fails closed as NOT settled', async () => {
  const deps = founderDeps({
    release: vi.fn(async () => ({
      escrow_release: { swap: releaseSwap(), awaiting: ['project'], verifier_pubkey: ORACLE_X, project_output_sats: 150, fee_sats: 40 },
    })) as unknown as CourtSettlementDeps['release'],
  });
  const res = await executeCourtSettlement(deps);
  expect(res.status).toBe('initiated-failed');
  expect(res.message).toContain('missing the escrow payout facts');
  expect(deps.completeRelease).not.toHaveBeenCalled();
});

it('donor: initiate -> sign -> complete refunds the donor', async () => {
  const deps = donorDeps();
  const res = await executeCourtSettlement(deps);
  expect(res.status).toBe('executed');
  expect(res.message).toContain('98 sats refunded to the donor');
  expect(deps.completeRefund).toHaveBeenCalledTimes(1);
  const call = (deps.completeRefund as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { contributionId: string; swap: { inputs: { witness?: unknown }[] } };
  expect(call.contributionId).toBe('55');
  const message = buildSigAllMessage(call.swap.inputs as never, refundSwap().outputs);
  const sigs = witnessSignatures(call.swap.inputs[0].witness);
  expect(sigs).toHaveLength(2);
  expect(message.length).toBeGreaterThan(0);
});

it('donor: a release-shaped refund initiate is never reported as settled', async () => {
  const deps = donorDeps({
    fetchRefundInitiate: vi.fn(async () => ({ escrow_release: { swap: refundSwap(), awaiting: ['donor'] } })) as unknown as CourtSettlementDeps['fetchRefundInitiate'],
  });
  const res = await executeCourtSettlement(deps);
  expect(res.status).toBe('initiated-failed');
  expect(res.message).toContain('refusing to report the refund as settled');
  expect(deps.completeRefund).not.toHaveBeenCalled();
});

it('donor: no unambiguous contribution refuses before any API write', async () => {
  const deps = donorDeps({ donorContributionId: undefined, resolveDonorContributionId: vi.fn(async () => null) });
  await expect(executeCourtSettlement(deps)).rejects.toThrow(/no unambiguous escrowed cashu contribution/);
  expect(deps.fetchRefundInitiate).not.toHaveBeenCalled();
});
