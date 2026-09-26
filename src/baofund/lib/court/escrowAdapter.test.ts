import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CourtGroupEpoch,
  CourtVerdict,
  CourtVerdictVerifier,
  EscrowAdapter,
  EscrowLock,
  EscrowRef,
  FrostSignerService,
  FrostSigningRequest,
  FrostSigningResponse,
  PrepareSettlementInput,
  RailCapabilities,
  RefundInput,
  SettlementNetwork,
  SettlementPlan,
  SettlementReceipt,
  SettlementSignatureRole,
} from './escrowAdapter';

// The module is types-only by design (ADR docs/adr/ADR-court-app-agnostic.md).
// These are compile-checked mock implementations: if the contract drifts, the
// typecheck stage of `verify-all` fails before any runtime assertion runs.

const escrow: EscrowRef = { app: 'bao.fund', escrowId: 'fr_2a3b4c5d6e7f' };

const verdict: CourtVerdict = {
  app: 'bao.fund',
  escrowId: escrow.escrowId,
  rail: 'cashu-nut11',
  disputeId: 'a'.repeat(64),
  attestationEventId: 'b'.repeat(64),
  groupPubkey: 'c'.repeat(64),
  outcome: 'd'.repeat(64),
  verdictHash: 'e'.repeat(64),
  round: 1,
};

function receipt(phase: SettlementReceipt['phase']): SettlementReceipt {
  return { phase, rail: 'cashu-nut11', planId: 'plan-1', escrow };
}

// A two-phase Cashu adapter (prepare -> initiate -> party completes) proves
// the `initiated` phase is representable and never collapsed into `settled`.
const cashuAdapter = {
  app: 'bao.fund',
  rail: 'cashu-nut11',
  network: 'mainnet',
  inspect: async () => ({
    rail: 'cashu-nut11',
    network: 'mainnet',
    lockId: 'token-secret-id',
    amountSats: 10_000,
    partyPubkeys: ['d'.repeat(64), 'f'.repeat(64)],
    oraclePubkey: verdict.groupPubkey,
    refundDeadline: 1_800_000_000,
  } satisfies EscrowLock),
  prepareSettlement: async (input: PrepareSettlementInput) => ({
    planId: `cashu:${input.escrow.escrowId}:${input.verdict.attestationEventId}`,
    escrow: input.escrow,
    rail: 'cashu-nut11',
    network: 'mainnet',
    verdict: input.verdict,
    action: 'release',
    instructions: { kind: 'nut11-sigall-swap' },
    requiredSignatures: ['oracle', 'party'],
    validUntil: input.nowSeconds + 3600,
  } satisfies SettlementPlan),
  settle: async () => receipt('initiated'),
  refund: async (_input: RefundInput) => receipt('settled'),
} satisfies EscrowAdapter;

// A tapscript adapter proves the same contract carries a different rail with
// a group-signed sighash instead of a NUT-11 co-sign.
const tapscriptAdapter = {
  app: 'bao.markets',
  rail: 'bitcoin-tapscript',
  network: 'testnet4',
  inspect: async () => null,
  prepareSettlement: async (input: PrepareSettlementInput) => ({
    planId: `tapscript:${input.escrow.escrowId}`,
    escrow: input.escrow,
    rail: 'bitcoin-tapscript',
    network: 'testnet4',
    verdict: input.verdict,
    action: 'release',
    instructions: { kind: 'tapscript-judge-leaf' },
    requiredSignatures: ['winner', 'group'],
    validUntil: input.nowSeconds + 7200,
  } satisfies SettlementPlan),
  settle: async () => receipt('settled'),
  refund: async () => receipt('settled'),
} satisfies EscrowAdapter;

const signer: FrostSignerService = {
  signSettlement: async (request: FrostSigningRequest) => ({
    groupPubkey: request.verdict.groupPubkey,
    signature: '00'.repeat(64),
    scheme: 'bip340',
  }),
  groupEpochs: async () => [
    { groupPubkey: verdict.groupPubkey, threshold: 3, participants: 5, epoch: 0, activatedAt: 0 } satisfies CourtGroupEpoch,
  ],
};

const verifier: CourtVerdictVerifier = {
  verifyVerdict: () => ({ valid: false, error: 'types-only mock' }),
};

describe('escrow adapter contract (types-only module)', () => {
  it('keeps the receipt phase a closed three-state set', () => {
    expectTypeOf<SettlementReceipt['phase']>().toEqualTypeOf<'settled' | 'initiated' | 'failed'>();
    expect(receipt('initiated').phase).toBe('initiated');
  });

  it('keeps rail instructions opaque and signature roles explicit', () => {
    expectTypeOf<SettlementPlan['instructions']>().toEqualTypeOf<unknown>();
    expectTypeOf<SettlementSignatureRole>().toEqualTypeOf<'oracle' | 'winner' | 'party' | 'funder' | 'group'>();
    expectTypeOf<SettlementNetwork>().toEqualTypeOf<
      'mainnet' | 'signet' | 'testnet4' | 'liquid-mainnet' | 'liquid-testnet'
    >();
  });

  it('accepts compile-checked adapters for two rails under one interface', () => {
    const adapters: readonly EscrowAdapter[] = [cashuAdapter, tapscriptAdapter];
    expect(adapters.map((a) => a.rail)).toEqual(['cashu-nut11', 'bitcoin-tapscript']);
  });

  it('types the signer as digest-in/schnorr-out with a BIP-340 response', () => {
    expectTypeOf<FrostSigningResponse>().toHaveProperty('scheme').toEqualTypeOf<'bip340'>();
    expectTypeOf(signer).toMatchTypeOf<FrostSignerService>();
  });

  it('exposes rail capabilities + verdict verification hooks', () => {
    const caps: RailCapabilities = {
      rail: 'cashu-nut11',
      networks: ['mainnet'],
      oracleSignature: 'nut11-sigall',
      supportsUnilateralRefund: false,
      requiresAppService: true,
    };
    expect(caps.requiresAppService).toBe(true);
    expect(verifier.verifyVerdict).toBeTypeOf('function');
  });

  it('requires the pinned real group key on a verdict', () => {
    // @ts-expect-error a verdict without groupPubkey is not a settlement authority
    const invalid: CourtVerdict = { ...verdict, groupPubkey: undefined };
    expect(invalid).toBeDefined();
  });
});
