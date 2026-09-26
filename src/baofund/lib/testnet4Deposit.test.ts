import { describe, expect, it } from 'vitest';
import {
  buildDepositGuidance,
  computeStageDescriptor,
  matchesDescriptor,
  parseXOnlyKey,
  registerBroadcast,
  validateUnsignedPsbt,
  DEPOSIT_GENESIS_ANCHOR,
  type GuidanceInput,
} from './testnet4Deposit';
import { BTC_TESTNET4_GENESIS_HASH, validateTestnet4Address } from './testnet4Rail';
import { NUMS_INTERNAL_XONLY, TESTNET4_PARAMS } from './testnet4Taproot';

// All key slots use the NUMS point hex: valid 32 bytes, no key material
// invented, and deterministic descriptors across runs.
const K = NUMS_INTERNAL_XONLY;

function guidanceInput(overrides: Partial<GuidanceInput> = {}): GuidanceInput {
  return {
    founderKeyHex: K,
    donorKeyHex: K,
    founderRecoveryKeyHex: K,
    investorKeyHex: K,
    times: {
      release: 900_000,
      releaseDomain: 'blocks',
      refundDeadline: 900_072,
      refundDomain: 'blocks',
      penaltyBlocks: 144,
      expiry: 950_000,
      expiryDomain: 'blocks',
    },
    stages: [{ stageId: 'stage-1', amountSats: 50_000, release: 900_000, releaseDomain: 'blocks' }],
    campaignCommitmentHex: Buffer.from('bao-campaign-test-commitment', 'utf8').toString('hex'),
    ...overrides,
  };
}

describe('parseXOnlyKey', () => {
  it('accepts 64-char lowercase hex', () => {
    expect(parseXOnlyKey(K, 'test').length).toBe(32);
  });

  it('rejects uppercase, short, odd, and non-hex input typed', () => {
    expect(() => parseXOnlyKey(K.toUpperCase(), 'k')).toThrow(/x-only/);
    expect(() => parseXOnlyKey(K.slice(2), 'k')).toThrow(/x-only/);
    expect(() => parseXOnlyKey(`${K.slice(0, 63)}g`, 'k')).toThrow(/x-only/);
    expect(() => parseXOnlyKey(undefined as unknown as string, 'k')).toThrow(/x-only/);
  });
});

describe('computeStageDescriptor', () => {
  it('produces a descriptor whose address validates on the testnet4 rail', () => {
    const d = computeStageDescriptor({
      founderKeyHex: K,
      donorKeyHex: K,
      founderRecoveryKeyHex: K,
      investorKeyHex: K,
      times: guidanceInput().times,
    });
    expect(d.rail).toBe('btc-testnet4');
    const parsed = validateTestnet4Address(d.address);
    expect(parsed.version).toBe(1);
    expect(parsed.programBytes.length).toBe(32);
  });

  it('is deterministic - byte-identical output for identical inputs', () => {
    const a = computeStageDescriptor({
      founderKeyHex: K,
      donorKeyHex: K,
      founderRecoveryKeyHex: K,
      investorKeyHex: K,
      times: guidanceInput().times,
    });
    const b = computeStageDescriptor({
      founderKeyHex: K,
      donorKeyHex: K,
      founderRecoveryKeyHex: K,
      investorKeyHex: K,
      times: guidanceInput().times,
    });
    expect(a.outputKeyHex).toBe(b.outputKeyHex);
    expect(a.address).toBe(b.address);
    expect(a.merkleRootHex).toBe(b.merkleRootHex);
    expect(a.scriptPubKeyHex).toBe(b.scriptPubKeyHex);
  });

  it('changes when the founder key changes (descriptor binds keys)', () => {
    const altFounder = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac1'; // sibling test vector value, not a key in use
    const a = computeStageDescriptor({
      founderKeyHex: K,
      donorKeyHex: K,
      founderRecoveryKeyHex: K,
      investorKeyHex: K,
      times: guidanceInput().times,
    });
    const b = computeStageDescriptor({
      founderKeyHex: altFounder,
      donorKeyHex: K,
      founderRecoveryKeyHex: K,
      investorKeyHex: K,
      times: guidanceInput().times,
    });
    expect(a.address).not.toBe(b.address);
  });

  it('carries the full Angor-parity leaf set in the descriptor', () => {
    const d = computeStageDescriptor({
      founderKeyHex: K,
      donorKeyHex: K,
      founderRecoveryKeyHex: K,
      investorKeyHex: K,
      times: guidanceInput().times,
    });
    const names = d.leaves.map((l) => l.name);
    expect(names).toContain('founder_claim');
    expect(names).toContain('donor_refund');
    expect(names).toContain('penalty_recovery_2of2');
    expect(names).toContain('penalty_csv');
    expect(names).toContain('project_expiry');
  });

  it('includes hashlock threshold leaves when lead investors are configured', () => {
    const d = computeStageDescriptor({
      founderKeyHex: K,
      donorKeyHex: K,
      founderRecoveryKeyHex: K,
      investorKeyHex: K,
      times: guidanceInput().times,
      leadSecretHashesHex: [Buffer.from('a'.repeat(64), 'hex').toString('hex')],
      leadThreshold: 1,
    });
    expect(d.leaves.some((l) => l.name.startsWith('hashlock_threshold_'))).toBe(true);
  });

  it('rejects a bad key slot with a typed error naming the field', () => {
    expect(() =>
      computeStageDescriptor({
        founderKeyHex: 'zz',
        donorKeyHex: K,
        founderRecoveryKeyHex: K,
        investorKeyHex: K,
        times: guidanceInput().times,
      }),
    ).toThrow(/founderKeyHex/);
  });

  it('echoes the NUMS internal key constant for wallet verification', () => {
    const d = computeStageDescriptor({
      founderKeyHex: K,
      donorKeyHex: K,
      founderRecoveryKeyHex: K,
      investorKeyHex: K,
      times: guidanceInput().times,
    });
    expect(d.internalKeyHex).toBe(NUMS_INTERNAL_XONLY);
  });
});

describe('buildDepositGuidance', () => {
  it('builds per-stage outputs in order with matching descriptors', () => {
    const g = buildDepositGuidance(
      guidanceInput({
        stages: [
          { stageId: 'alpha', amountSats: 10_000, release: 900_000, releaseDomain: 'blocks' },
          { stageId: 'beta', amountSats: 20_000, release: 900_000, releaseDomain: 'blocks' },
        ],
      }),
    );
    expect(g.outputs.length).toBe(2);
    expect(g.outputs[0].stageId).toBe('alpha');
    expect(g.outputs[1].stageId).toBe('beta');
    expect(g.outputs[0].amountSats).toBe(10_000);
    for (const o of g.outputs) {
      expect(o.address).toBe(o.descriptor.address);
      expect(o.scriptPubKeyHex).toBe(o.descriptor.scriptPubKeyHex);
    }
  });

  it('pins rail, network genesis and the no-value notice', () => {
    const g = buildDepositGuidance(guidanceInput());
    expect(g.rail).toBe('btc-testnet4');
    expect(g.network.hrp).toBe(TESTNET4_PARAMS.hrp);
    expect(g.network.genesisHash).toBe(BTC_TESTNET4_GENESIS_HASH);
    expect(g.noValueNotice).toContain('testnet4');
    expect(g.noValueNotice).toContain('no value');
  });

  it('emits an OP_RETURN script for the campaign commitment (≤80B standardness)', () => {
    const payload = 'bao:campaign:abc123';
    const g = buildDepositGuidance(
      guidanceInput({ campaignCommitmentHex: Buffer.from(payload, 'utf8').toString('hex') }),
    );
    expect(g.opReturn.hexPayload.startsWith('6a')).toBe(true);
    // push length byte matches payload size
    expect(parseInt(g.opReturn.hexPayload.slice(2, 4), 16)).toBe(payload.length);
    expect(g.opReturn.asciiPreview).toBe(payload);
  });

  it('refuses an OP_RETURN payload over 80 bytes', () => {
    expect(() =>
      buildDepositGuidance(guidanceInput({ campaignCommitmentHex: 'ab'.repeat(81) })),
    ).toThrow(/OP_RETURN/);
  });

  it('refuses an empty commitment and non-positive/oversized amounts', () => {
    expect(() => buildDepositGuidance(guidanceInput({ campaignCommitmentHex: '' }))).toThrow(/empty/);
    expect(() =>
      buildDepositGuidance(guidanceInput({ stages: [{ stageId: 's', amountSats: 0, release: 1, releaseDomain: 'blocks' }] })),
    ).toThrow(/amountSats/);
    expect(() =>
      buildDepositGuidance(
        guidanceInput({ stages: [{ stageId: 's', amountSats: 22_000_000_000_000_00, release: 1, releaseDomain: 'blocks' }] }),
      ),
    ).toThrow(/supply/);
  });

  it('refuses an empty stage list', () => {
    expect(() => buildDepositGuidance(guidanceInput({ stages: [] }))).toThrow(/at least one stage/);
  });

  it('accepts a structurally valid unsigned PSBT and rejects garbage', () => {
    // BIP-174 magic "psbt" + 0xff, base64-encoded.
    const magic = Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]).toString('base64');
    expect(validateUnsignedPsbt(magic)).toBe(magic);
    expect(() => validateUnsignedPsbt('not-base64!!!')).toThrow(/base64/);
    expect(() => validateUnsignedPsbt(Buffer.from('hello').toString('base64'))).toThrow(/magic/);
    expect(() => validateUnsignedPsbt('')).toThrow(/non-empty/);
  });

  it('carries a prebuilt PSBT through when provided', () => {
    const magic = Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]).toString('base64');
    const g = buildDepositGuidance(guidanceInput({ prebuiltPsbtBase64: magic }));
    expect(g.psbt).toBe(magic);
  });

  it('points the founder at the testnet4 explorer', () => {
    const g = buildDepositGuidance(guidanceInput());
    expect(g.explorerBase).toBe('https://mempool.space/testnet4');
  });

  it('is JSON-serializable (route payloads must survive the wire)', () => {
    const g = buildDepositGuidance(guidanceInput());
    expect(JSON.parse(JSON.stringify(g))).toEqual(g);
  });
});

describe('registerBroadcast', () => {
  const TXID = 'a'.repeat(64);

  it('moves awaiting_funding → broadcast and records the txid', () => {
    const next = registerBroadcast(
      { rail: 'btc-testnet4', descriptorAddress: 'tb1q', expectedAmountSats: 1, status: 'awaiting_funding' },
      TXID,
    );
    expect(next.status).toBe('broadcast');
    expect(next.txid).toBe(TXID);
  });

  it('rejects malformed txids (shape only - chain identity is the probe’s job)', () => {
    expect(() =>
      registerBroadcast(
        { rail: 'btc-testnet4', descriptorAddress: 'tb1q', expectedAmountSats: 1, status: 'awaiting_funding' },
        'A'.repeat(64),
      ),
    ).toThrow(/malformed|hex/);
    expect(() =>
      registerBroadcast(
        { rail: 'btc-testnet4', descriptorAddress: 'tb1q', expectedAmountSats: 1, status: 'awaiting_funding' },
        'a'.repeat(63),
      ),
    ).toThrow(/64/);
  });

  it('refuses registration on terminal states', () => {
    for (const status of ['confirmed', 'spent_claim', 'spent_refund'] as const) {
      expect(() =>
        registerBroadcast(
          { rail: 'btc-testnet4', descriptorAddress: 'tb1q', expectedAmountSats: 1, status },
          TXID,
        ),
      ).toThrow(/bad_state/);
    }
  });
});

describe('matchesDescriptor', () => {
  it('matches observed scriptPubKey case-insensitively and rejects foreign outputs', () => {
    const d = computeStageDescriptor({
      founderKeyHex: K,
      donorKeyHex: K,
      founderRecoveryKeyHex: K,
      investorKeyHex: K,
      times: guidanceInput().times,
    });
    expect(matchesDescriptor(d.scriptPubKeyHex.toUpperCase(), d)).toBe(true);
    expect(matchesDescriptor('5120' + '0'.repeat(64), d)).toBe(false);
  });
});

describe('DEPOSIT_GENESIS_ANCHOR', () => {
  it('equals the rail constant (evidence records pin the same chain)', () => {
    expect(DEPOSIT_GENESIS_ANCHOR).toBe(BTC_TESTNET4_GENESIS_HASH);
  });
});
