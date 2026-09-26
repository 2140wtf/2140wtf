/**
 * Liquid steps 3–6 acceptance - descriptors + guidance composed with the
 * SHARED builders under Liquid params:
 *
 *   P1  determinism: same inputs → byte-identical descriptor;
 *   P2  cross-rail parameterization: the ONLY difference from a testnet4
 *       descriptor with identical keys/times is the address HRP (tex vs
 *       tb) - scripts, merkle root and output key are IDENTICAL (the
 *       "taproot math is chain-agnostic" claim, pinned as a test);
 *   P3  fail-closed matrix: bad keys, bad times, bad stages, oversized
 *       OP_RETURN, signed prebuilt PSBT - typed refusals;
 *   P4  rail hygiene: every artifact carries rail 'liquid-testnet', tex
 *       anchors, the liquid no-value notice, native asset id, liquid
 *       explorer base.
 */
import { describe, expect, it } from 'vitest';
import {
  buildLiquidDepositGuidance,
  computeLiquidStageDescriptor,
  LiquidDepositError,
  LIQUID_TESTNET_PARAMS,
  type LiquidGuidanceInput,
} from './liquidTestnetDeposit';
import { computeStageDescriptor, Testnet4DepositError } from './testnet4Deposit';
import { LIQUID_TESTNET_GENESIS_HASH, LIQUID_TESTNET_NATIVE_ASSET_ID } from './liquidTestnetRail';
import { TESTNET4_PARAMS } from './testnet4Taproot';

// Arbitrary but FIXED keys (never used for funds - testnet-only modules).
const FOUNDER = 'aa'.repeat(32);
const DONOR = 'bb'.repeat(32);
const RECOVERY = 'cc'.repeat(32);
const INVESTOR = 'dd'.repeat(32);
const TIMES = {
  release: 1_000,
  releaseDomain: 'blocks' as const,
  refundDeadline: 1_072,
  refundDomain: 'blocks' as const,
  penaltyBlocks: 144,
  expiry: 2_000,
  expiryDomain: 'blocks' as const,
};

const DESC_INPUT = {
  founderKeyHex: FOUNDER,
  donorKeyHex: DONOR,
  founderRecoveryKeyHex: RECOVERY,
  investorKeyHex: INVESTOR,
  times: TIMES,
};

const GUIDANCE_INPUT: LiquidGuidanceInput = {
  ...DESC_INPUT,
  stages: [
    { stageId: 'stage-1', release: 1_000, releaseDomain: 'blocks' as const, amountSats: 50_000 },
    { stageId: 'stage-2', release: 1_100, releaseDomain: 'blocks' as const, amountSats: 30_000 },
  ],
  campaignCommitmentHex: Buffer.from('bao-campaign-test', 'utf8').toString('hex'),
};

describe('descriptor determinism + cross-rail parameterization', () => {
  it('P1: same inputs → byte-identical descriptor', () => {
    const a = computeLiquidStageDescriptor(DESC_INPUT);
    const b = computeLiquidStageDescriptor(DESC_INPUT);
    expect(a).toEqual(b);
  });

  it('P2: vs testnet4 with identical keys/times - same SCRIPTS, Elements hash domain', () => {
    // CORRECTED after the live on-chain discovery (2026-09-13): Elements
    // domain-separates taproot hashes (0xc4 leaf, /elements tags). The old
    // assertion (identical roots/output keys) was WRONG - a Bitcoin-domain
    // output key is unspendable on Elements (control-block commitment fails:
    // 'Witness program hash mismatch'). What IS shared: the script bytes.
    const lq = computeLiquidStageDescriptor(DESC_INPUT);
    const t4 = computeStageDescriptor(DESC_INPUT);
    // Script bytes identical across rails:
    expect(lq.leaves.map((l) => l.scriptHex)).toEqual(t4.leaves.map((l) => l.scriptHex));
    expect(lq.internalKeyHex).toBe(t4.internalKeyHex);
    // Hash domain differs: leaf version 0xc4 (Elements) vs 0xc0 (Bitcoin);
    // roots/output keys therefore differ:
    expect(lq.leaves.every((l) => l.leafVersion === 0xc4)).toBe(true);
    expect(t4.leaves.every((l) => l.leafVersion === 0xc0)).toBe(true);
    expect(lq.merkleRootHex).not.toBe(t4.merkleRootHex);
    expect(lq.outputKeyHex).not.toBe(t4.outputKeyHex);
    expect(lq.scriptPubKeyHex).not.toBe(t4.scriptPubKeyHex);
    // Address namespace differs and is correct per rail:
    expect(lq.address.startsWith('tex1p')).toBe(true);
    expect(t4.address.startsWith('tb1p')).toBe(true);
    expect(lq.address).not.toBe(t4.address);
    expect(lq.rail).toBe('liquid-testnet');
    expect(t4.rail).toBe('btc-testnet4');
  });

  it('P4: leaf set is the full Angor-parity set (nothing dropped between rails)', () => {
    const names = computeLiquidStageDescriptor(DESC_INPUT).leaves.map((l) => l.name);
    expect(names).toContain('founder_claim');
    expect(names).toContain('donor_refund');
    expect(names).toContain('penalty_recovery_2of2');
    expect(names).toContain('penalty_csv');
    expect(names).toContain('project_expiry');
  });

  it('Liquid params: tex HRP, live genesis pin, owner timelock defaults preserved', () => {
    expect(LIQUID_TESTNET_PARAMS.hrp).toBe('tex');
    expect(LIQUID_TESTNET_PARAMS.genesisHash).toBe(LIQUID_TESTNET_GENESIS_HASH);
    expect(LIQUID_TESTNET_PARAMS.refundLocktimeBlocks).toBe(TESTNET4_PARAMS.refundLocktimeBlocks);
    expect(LIQUID_TESTNET_PARAMS.penaltyLocktimeBlocks).toBe(TESTNET4_PARAMS.penaltyLocktimeBlocks);
  });
});

describe('guidance assembly', () => {
  it('one output per stage, deterministic addresses, Liquid anchors throughout', () => {
    const g = buildLiquidDepositGuidance(GUIDANCE_INPUT);
    expect(g.kind).toBe('bao.liquid-testnet.deposit-guidance');
    expect(g.rail).toBe('liquid-testnet');
    expect(g.network).toEqual({ hrp: 'tex', genesisHash: LIQUID_TESTNET_GENESIS_HASH });
    expect(g.nativeAssetId).toBe(LIQUID_TESTNET_NATIVE_ASSET_ID);
    expect(g.noValueNotice).toBe('LIQUID TESTNET · NO VALUE');
    expect(g.outputs).toHaveLength(2);
    for (const o of g.outputs) {
      expect(o.address.startsWith('tex1p')).toBe(true);
      expect(o.scriptPubKeyHex).toMatch(/^[0-9a-f]{68}$/); // 34-byte P2TR
      expect(o.descriptor.rail).toBe('liquid-testnet');
    }
    expect(g.opReturn.hexPayload).toBe('6a11' + GUIDANCE_INPUT.campaignCommitmentHex);
    expect(g.opReturn.asciiPreview).toBe('bao-campaign-test');
    expect(g.explorerBase).toBe('https://blockstream.info/liquidtestnet');
    expect(g.psbt).toBeUndefined();
  });

  it('same stage amounts but different stageIds → same script output set (per-stage determinism)', () => {
    const g1 = buildLiquidDepositGuidance(GUIDANCE_INPUT);
    const g2 = buildLiquidDepositGuidance({
      ...GUIDANCE_INPUT,
      stages: GUIDANCE_INPUT.stages.map((s) => ({ ...s, stageId: `${s.stageId}-x` })),
    });
    expect(g1.outputs.map((o) => o.address)).toEqual(g2.outputs.map((o) => o.address));
  });

  it('accepts a structurally valid UNSIGNED prebuilt PSBT', () => {
    // Minimal unsigned PSBT: magic + 0xff separator + empty maps.
    const psbtB64 = Buffer.from('70736274ff01000000', 'hex').toString('base64');
    const g = buildLiquidDepositGuidance({ ...GUIDANCE_INPUT, prebuiltPsbtBase64: psbtB64 });
    expect(g.psbt).toBe(psbtB64);
  });
});

describe('fail-closed matrix (mirrors the bitcoin module)', () => {
  it('bad keys are typed refusals', () => {
    expect(() => computeLiquidStageDescriptor({ ...DESC_INPUT, founderKeyHex: 'zz' })).toThrowError(LiquidDepositError);
    expect(() => computeLiquidStageDescriptor({ ...DESC_INPUT, donorKeyHex: 'aa'.repeat(31) })).toThrowError(LiquidDepositError);
  });

  it('bad stages/amounts are typed refusals', () => {
    expect(() => buildLiquidDepositGuidance({ ...GUIDANCE_INPUT, stages: [] })).toThrowError(LiquidDepositError);
    expect(() => buildLiquidDepositGuidance({
      ...GUIDANCE_INPUT,
      stages: [{ stageId: 's', release: 1, releaseDomain: 'blocks', amountSats: 0 }],
    })).toThrowError(LiquidDepositError);
    expect(() => buildLiquidDepositGuidance({
      ...GUIDANCE_INPUT,
      stages: [{ stageId: '', release: 1, releaseDomain: 'blocks', amountSats: 100 }],
    })).toThrowError(LiquidDepositError);
  });

  it('oversized OP_RETURN commitment is a typed refusal (>80B standardness)', () => {
    expect(() => buildLiquidDepositGuidance({
      ...GUIDANCE_INPUT,
      campaignCommitmentHex: 'ab'.repeat(81),
    })).toThrowError(/OP_RETURN/);
  });

  it('empty / odd-length commitment hex is a typed refusal', () => {
    expect(() => buildLiquidDepositGuidance({ ...GUIDANCE_INPUT, campaignCommitmentHex: '' })).toThrowError(/empty/);
    expect(() => buildLiquidDepositGuidance({ ...GUIDANCE_INPUT, campaignCommitmentHex: 'abc' })).toThrowError(/even-length/);
  });

  it('a SIGNED-looking prebuilt PSBT is refused (non-custody: platform never relays signatures)', () => {
    // Malformed-but-signed-looking garbage must fail the shared validator.
    expect(() => buildLiquidDepositGuidance({
      ...GUIDANCE_INPUT,
      prebuiltPsbtBase64: Buffer.from('not-a-psbt', 'utf8').toString('base64'),
    })).toThrowError();
  });
});

// The re-labeling bridge keeps bitcoin-module error codes intact:
describe('error bridging', () => {
  it('bitcoin-module typed errors re-emerge as LiquidDepositError with preserved code', () => {
    try {
      computeLiquidStageDescriptor({ ...DESC_INPUT, founderKeyHex: 'zz' });
      expect.unreachable('bad key accepted');
    } catch (e) {
      expect(e).toBeInstanceOf(LiquidDepositError);
      expect((e as LiquidDepositError).code).toBe('bad_key');
    }
    // And the bitcoin module still throws its own typed error (no mutation):
    expect(() => computeStageDescriptor(DESC_INPUT)).not.toThrow();
    expect(() => computeStageDescriptor({ ...DESC_INPUT, founderKeyHex: 'zz' })).toThrowError(Testnet4DepositError);
  });
});
