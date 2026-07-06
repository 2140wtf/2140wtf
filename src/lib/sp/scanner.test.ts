/**
 * Tests for the BIP-352 tweak scanner.
 *
 * Builds pre-computed tweak entries from the canonical receive vectors and
 * verifies that {@link scanTweakEntry} / {@link scanBatch} discover the same
 * outputs as the full per-transaction scanner.
 */
import { describe, expect, it } from 'vitest';

import {
  extractEligibleInputPubKey,
  pointFromBytes,
  taggedHash,
  concatBytes,
  bytesToScalar,
  compareBytes,
  type ScannableInput,
} from '../silentPayments';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import { scanBatch, scanTweakEntry, type ScanTweakEntry } from './scanner';

import vectors from '../../test/fixtures/bip352_receive_vectors.json';

interface VinJSON {
  txid: string;
  vout: number;
  scriptSig: string;
  txinwitness: string;
  prevout: { scriptPubKey: { hex: string } };
}

interface ReceivingCase {
  comment?: string;
  given: {
    vin: VinJSON[];
    outputs: string[];
    key_material: {
      scan_priv_key: string;
      spend_priv_key: string;
    };
    labels?: string[];
  };
  expected: {
    outputs: Array<{
      pub_key: string;
      priv_key_tweak: string;
    }>;
  };
}

interface TestCaseJSON {
  comment: string;
  receiving: ReceivingCase[];
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('odd hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function parseWitness(hex: string): Uint8Array[] {
  if (!hex) return [];
  const out: Uint8Array[] = [];
  let off = 0;
  const bytes = hexToBytes(hex);
  if (bytes.length === 0) return [];
  const count = bytes[off++];
  for (let i = 0; i < count; i++) {
    let len = bytes[off++];
    if (len >= 0xfd) {
      len = bytes[off] | (bytes[off + 1] << 8);
      off += 2;
    }
    out.push(bytes.subarray(off, off + len));
    off += len;
  }
  return out;
}

function serializeOutpoint(txidHex: string, vout: number): Uint8Array {
  const txid = hexToBytes(txidHex);
  txid.reverse();
  const voutBuf = new Uint8Array(4);
  voutBuf[0] = vout & 0xff;
  voutBuf[1] = (vout >>> 8) & 0xff;
  voutBuf[2] = (vout >>> 16) & 0xff;
  voutBuf[3] = (vout >>> 24) & 0xff;
  return concatBytes(txid, voutBuf);
}

/**
 * Recompute the per-transaction tweak `input_hash · A` the indexer would have
 * returned for this transaction.
 */
function buildTweakEntry(c: ReceivingCase, height = 1): ScanTweakEntry | null {
  const inputs: ScannableInput[] = c.given.vin.map((v) => ({
    txid: v.txid,
    vout: v.vout,
    scriptPubKeyHex: v.prevout.scriptPubKey.hex,
    scriptSigHex: v.scriptSig,
    witness: parseWitness(v.txinwitness),
  }));

  const eligiblePubkeys: Uint8Array[] = [];
  for (const input of inputs) {
    const eligible = extractEligibleInputPubKey(
      input.scriptPubKeyHex,
      input.scriptSigHex,
      input.witness,
    );
    if (eligible) eligiblePubkeys.push(eligible.pubkey);
  }

  let A: InstanceType<typeof secp256k1.Point> | null = null;
  for (const pk of eligiblePubkeys) {
    const P = pointFromBytes(pk);
    A = A ? A.add(P) : P;
  }
  if (!A) return null;

  let smallest: Uint8Array | null = null;
  for (const input of inputs) {
    const ser = serializeOutpoint(input.txid, input.vout);
    if (smallest === null || compareBytes(ser, smallest) < 0) {
      smallest = ser;
    }
  }
  if (!smallest) return null;

  const Aaff = A.toAffine();
  if (Aaff.x === 0n && Aaff.y === 0n) return null;
  const aPub = A.toBytes(true);
  const inputHash = taggedHash('BIP0352/Inputs', concatBytes(smallest, aPub));
  const inputHashScalar = bytesToScalar(inputHash);

  const tweak = A.multiply(inputHashScalar).toBytes(true);

  return {
    height,
    tweak,
    outputs: c.given.outputs.map((xonly, i) => ({
      txid: '0000000000000000000000000000000000000000000000000000000000000000',
      vout: i,
      xonlyPk: hexToBytes(xonly),
      value: 1000,
    })),
  };
}

describe('scanTweakEntry', () => {
  const cases = (vectors as TestCaseJSON[])
    .flatMap((tc) => tc.receiving)
    .filter((c) => !c.given.labels?.length && Array.isArray(c.expected.outputs))
    .map((c, i) => ({ c, entry: buildTweakEntry(c), i }))
    .filter((x): x is { c: ReceivingCase; entry: ScanTweakEntry; i: number } => x.entry !== null);

  it.each(cases.map(({ c, i }) => [c.comment ?? `case-${i}`, c, i]))(
    'discovers outputs from tweak: %s',
    (_name, c, _i) => {
      const entry = buildTweakEntry(c);
      if (!entry) throw new Error('Unexpected null tweak entry');
      const scanPrivKey = hexToBytes(c.given.key_material.scan_priv_key);
      const spendPrivKey = hexToBytes(c.given.key_material.spend_priv_key);
      const spendPubKey = secp256k1.getPublicKey(spendPrivKey, true);

      const found = scanTweakEntry(entry, scanPrivKey, spendPubKey);

      expect(found).toHaveLength(c.expected.outputs.length);
      for (const expected of c.expected.outputs) {
        const match = found.find((f) => {
          const xonly = entry.outputs[f.vout].xonlyPk;
          return Buffer.from(xonly).toString('hex') === expected.pub_key;
        });
        expect(match).toBeDefined();
      }
    },
  );
});

describe('scanBatch', () => {
  it('processes multiple entries and reports progress', async () => {
    const cases = (vectors as TestCaseJSON[])
      .flatMap((tc) => tc.receiving)
      .filter((c) => !c.given.labels?.length && Array.isArray(c.expected.outputs))
      .map((c) => ({ c, entry: buildTweakEntry(c) }))
      .filter((x): x is { c: ReceivingCase; entry: ScanTweakEntry } => x.entry !== null)
      .slice(0, 3);

    expect(cases.length).toBeGreaterThan(0);
    const entries = cases.map(({ c }, i) => buildTweakEntry(c, 100 + i) as ScanTweakEntry);
    const scanPrivKey = hexToBytes(cases[0].c.given.key_material.scan_priv_key);
    const spendPrivKey = hexToBytes(cases[0].c.given.key_material.spend_priv_key);
    const spendPubKey = secp256k1.getPublicKey(spendPrivKey, true);

    const progressHeights: number[] = [];
    const found = await scanBatch(entries, scanPrivKey, spendPubKey, {
      yieldEvery: 1,
      onProgress: (h) => progressHeights.push(h),
    });

    const expectedCount = cases.reduce((sum, { c }) => sum + c.expected.outputs.length, 0);
    expect(found).toHaveLength(expectedCount);
    expect(progressHeights.length).toBeGreaterThan(0);
    expect(progressHeights[progressHeights.length - 1]).toBe(102);
  });
});
