/**
 * WS9 round-4 fuzz: the testnet4 donor_refund spend builder.
 *
 * The builder is the last gate before a refund transaction is broadcast, so
 * the property under fuzz is fail-closed: every mutated descriptor/stage/UTXO
 * either reproduces a fully consistent spend or throws `Testnet4RefundError`
 * before anything is signed/broadcast. The CLTV leaf parser must never hang
 * or return an implausible height from arbitrary script bytes.
 *
 * Deterministic (mulberry32), pure crypto only - no network.
 */
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { NUMS_INTERNAL_XONLY, bytesToHex, buildContributionOutput } from './testnet4Taproot';
import {
  Testnet4RefundError,
  buildRefundSpend,
  refundCltvHeight,
  type SavedContributionDescriptor,
} from './testnet4Refund';

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const HEX = '0123456789abcdef';
/** Flip ONE hex digit (same length: parsing keeps working, checks must fail). */
function flipHex(rnd: () => number, value: string): string {
  if (value.length === 0) return value;
  const i = Math.floor(rnd() * value.length);
  const cur = value[i]!.toLowerCase();
  const next = HEX[(HEX.indexOf(cur) + 1 + Math.floor(rnd() * 15)) % 16]!;
  return value.slice(0, i) + next + value.slice(i + 1);
}

const donorSecret = secp256k1.utils.randomSecretKey();
const REFUND_UNLOCK = 200;
const AMOUNT = 50_000;
const built = buildContributionOutput(
  {
    donorKeyXOnly: secp256k1.getPublicKey(donorSecret, true).slice(1),
    founderKeyXOnly: new Uint8Array(32).fill(0xbb),
    founderRecoveryKeyXOnly: new Uint8Array(32).fill(0xcc),
    investorKeyXOnly: new Uint8Array(32).fill(0xdd),
  },
  {
    release: 1_800_000_000, releaseDomain: 'seconds',
    refundDeadline: REFUND_UNLOCK, refundDomain: 'blocks',
    penaltyBlocks: 144, expiry: 1_900_000_000, expiryDomain: 'seconds',
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
  depositTxid: 'a1'.repeat(32),
  vout: 0,
  amountSats: AMOUNT,
  scriptPubKeyHex: descriptor.scriptPubKeyHex,
  refundUnlock: REFUND_UNLOCK,
};
const depositVouts = [{ scriptpubkey: descriptor.scriptPubKeyHex, value: AMOUNT }];

describe('testnet4 refund - fuzz (round 4)', () => {
  it('single-digit descriptor/stage mutations rebuild a consistent spend or throw typed', () => {
    const rnd = mulberry32(0x5eed10);
    type MutableDescriptor = { -readonly [K in keyof SavedContributionDescriptor]: SavedContributionDescriptor[K] } & {
      leaves: { name: string; scriptHex: string; leafVersion: number }[];
    };
    for (let i = 0; i < 300; i++) {
      const descriptorMu = structuredClone(descriptor) as MutableDescriptor;
      const stageMu = { ...stage };
      const voutsMu = structuredClone(depositVouts);
      switch (i % 6) {
        case 0: descriptorMu.merkleRootHex = flipHex(rnd, descriptorMu.merkleRootHex); break;
        case 1: descriptorMu.outputKeyHex = flipHex(rnd, descriptorMu.outputKeyHex); break;
        case 2: descriptorMu.scriptPubKeyHex = flipHex(rnd, descriptorMu.scriptPubKeyHex); break;
        case 3: descriptorMu.leaves[1]!.scriptHex = flipHex(rnd, descriptorMu.leaves[1]!.scriptHex); break;
        case 4: stageMu.refundUnlock = REFUND_UNLOCK + 1; break;
        default: voutsMu[0]!.value = AMOUNT + Math.floor(rnd() * 100); break;
      }
      try {
        const out = buildRefundSpend({
          stage: stageMu, descriptor: descriptorMu,
          donorSecretKeyHex: bytesToHex(donorSecret),
          depositVouts: voutsMu, feeSats: 400,
        });
        expect(out.rawTxHex).toMatch(/^[0-9a-f]+$/);
        expect(out.cltvHeight).toBe(stageMu.refundUnlock);
      } catch (err) {
        expect(err).toBeInstanceOf(Testnet4RefundError);
      }
    }
    // The untouched fixture still builds (the fuzz did not corrupt it).
    expect(() => buildRefundSpend({ stage, descriptor, donorSecretKeyHex: bytesToHex(donorSecret), depositVouts, feeSats: 400 })).not.toThrow();
  });

  it('invalid fees never sign: 0/negative/NaN/over-value all fail closed', () => {
    const bad = [0, -1, -AMOUNT, Number.NaN, Number.POSITIVE_INFINITY, AMOUNT, AMOUNT + 1, AMOUNT * 2, 1.5];
    for (let i = 0; i < 200; i++) {
      const fee = bad[i % bad.length]!;
      try {
        buildRefundSpend({ stage, descriptor, donorSecretKeyHex: bytesToHex(donorSecret), depositVouts, feeSats: fee });
        // Only fees in (0, AMOUNT) may ever build.
        expect(fee).toBeGreaterThan(0);
        expect(fee).toBeLessThan(AMOUNT);
      } catch (err) {
        expect(err).toBeInstanceOf(Testnet4RefundError);
      }
    }
  });

  it('CLTV leaf parser bounds arbitrary script bytes (no hang, typed error or safe height)', () => {
    const rnd = mulberry32(0x5eed12);
    for (let i = 0; i < 500; i++) {
      const n = Math.floor(rnd() * 101); // 0..100 bytes
      const scriptHex = Array.from({ length: n }, () => HEX[Math.floor(rnd() * 16)]!).join('').padEnd(2 * n, '0');
      const desc: SavedContributionDescriptor = {
        ...descriptor,
        leaves: [{ name: 'donor_refund', scriptHex, leafVersion: 0xc0 }],
      };
      try {
        const h = refundCltvHeight(desc);
        expect(Number.isSafeInteger(h)).toBe(true);
        expect(h).toBeGreaterThan(0);
        expect(h).toBeLessThan(500_000_000);
      } catch (err) {
        expect(err).toBeInstanceOf(Testnet4RefundError);
      }
    }
    // Missing / empty leaves fail closed rather than guessing.
    expect(() => refundCltvHeight({ ...descriptor, leaves: [] })).toThrow(Testnet4RefundError);
    expect(() => refundCltvHeight({ ...descriptor, leaves: [{ name: 'donor_refund', scriptHex: '', leafVersion: 0xc0 }] })).toThrow(Testnet4RefundError);
  });
});
