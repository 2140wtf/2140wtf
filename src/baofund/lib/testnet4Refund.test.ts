/**
 * testnet4Refund - offline build/verify fixture for the donor_refund spend.
 * Real taproot math + real signing (no network): if the descriptor, UTXO,
 * value or CLTV no longer agree, buildRefundSpend must throw and broadcast
 * nothing. The live broadcast E2E stays an owner-run rail script.
 */
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  NUMS_INTERNAL_XONLY,
  bytesToHex,
  buildContributionOutput,
} from './testnet4Taproot';
import { Testnet4RefundError, buildRefundSpend, type SavedContributionDescriptor } from './testnet4Refund';

const donorSecret = secp256k1.utils.randomSecretKey();
const donorXOnly = secp256k1.getPublicKey(donorSecret, true).slice(1);
const REFUND_UNLOCK = 200;
const AMOUNT = 50_000;
const DEPOSIT = 'a1'.repeat(32);

const built = buildContributionOutput(
  {
    donorKeyXOnly: donorXOnly,
    founderKeyXOnly: new Uint8Array(32).fill(0xbb),
    founderRecoveryKeyXOnly: new Uint8Array(32).fill(0xcc),
    investorKeyXOnly: new Uint8Array(32).fill(0xdd),
  },
  {
    release: 1_800_000_000,
    releaseDomain: 'seconds',
    refundDeadline: REFUND_UNLOCK,
    refundDomain: 'blocks',
    penaltyBlocks: 144,
    expiry: 1_900_000_000,
    expiryDomain: 'seconds',
  },
);

const descriptor: SavedContributionDescriptor = {
  address: built.address,
  outputKeyHex: bytesToHex(built.outputXOnly),
  merkleRootHex: bytesToHex(built.merkleRoot),
  scriptPubKeyHex: bytesToHex(built.scriptPubKey),
  internalKeyHex: NUMS_INTERNAL_XONLY,
  leaves: built.leaves.map((l) => ({ name: l.name, scriptHex: bytesToHex(l.script), leafVersion: l.leafVersion })),
};

const stage = {
  depositTxid: DEPOSIT,
  vout: 0,
  amountSats: AMOUNT,
  scriptPubKeyHex: descriptor.scriptPubKeyHex,
  refundUnlock: REFUND_UNLOCK,
};

const depositVouts = [{ scriptpubkey: descriptor.scriptPubKeyHex, value: AMOUNT }];

function build(over: Partial<Parameters<typeof buildRefundSpend>[0]> = {}) {
  return buildRefundSpend({
    stage,
    descriptor,
    donorSecretKeyHex: bytesToHex(donorSecret),
    depositVouts,
    feeSats: 400,
    ...over,
  });
}

describe('buildRefundSpend - fail-closed donor refund', () => {
  it('builds a signed donor_refund spend paying the donor their own address', () => {
    const out = build();
    expect(out.cltvHeight).toBe(REFUND_UNLOCK);
    expect(/^[0-9a-f]+$/.test(out.rawTxHex)).toBe(true);
    expect(out.rawTxHex.length).toBeGreaterThan(50);
    expect(out.feeSats).toBe(400);
    expect(out.destination.startsWith('tb1p')).toBe(true);
  });

  it('refuses a value that does not match the funded output', () => {
    expect(() => build({ depositVouts: [{ scriptpubkey: descriptor.scriptPubKeyHex, value: AMOUNT - 1 }] })).toThrow(
      Testnet4RefundError,
    );
    try { build({ depositVouts: [{ scriptpubkey: descriptor.scriptPubKeyHex, value: AMOUNT - 1 }] }); }
    catch (e) { expect((e as Testnet4RefundError).code).toBe('utxo_mismatch'); }
  });

  it('refuses a vout that is not the claimed index', () => {
    expect(() => build({ stage: { ...stage, vout: 1 } })).toThrow(/no output 1/);
  });

  it('refuses a descriptor whose scriptPubKey was altered', () => {
    const tampered = { ...descriptor, scriptPubKeyHex: '00'.repeat(34) };
    expect(() => build({ descriptor: tampered })).toThrow(/scriptPubKey mismatch/);
  });

  it('refuses when the stage CLTV does not match the leaf', () => {
    try {
      build({ stage: { ...stage, refundUnlock: REFUND_UNLOCK + 1 } });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Testnet4RefundError).code).toBe('cltv_mismatch');
    }
  });

  it('an unrelated donor key cannot produce the spend', () => {
    const other = secp256k1.utils.randomSecretKey();
    expect(() => build({ donorSecretKeyHex: bytesToHex(other) })).toThrow();
  });
});
