/**
 * BIP352 silent payment receiver-side scanner tests.
 *
 * Validates {@link scanSilentPaymentTransaction} against the canonical
 * `send_and_receive_test_vectors.json` from
 * `https://github.com/bitcoin/bips/tree/master/bip-0352`.
 */
import { describe, expect, it } from 'vitest';

import { scanSilentPaymentTransaction, type ScannableInput, type ScannableOutput } from './silentPayments';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import vectors from '../test/fixtures/bip352_receive_vectors.json';

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
    // varint length
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

function p2trScriptPubKeyFromXOnly(xonly: string): string {
  return `5120${xonly}`;
}

describe('scanSilentPaymentTransaction', () => {
  const cases = (vectors as TestCaseJSON[])
    .flatMap((tc) => tc.receiving)
    .filter((c) => !c.given.labels?.length && Array.isArray(c.expected.outputs));

  it.each(cases.map((c, i) => [c.comment ?? `case-${i}`, c]))(
    'discovers outputs: %s',
    (_name, c) => {
      const inputs: ScannableInput[] = c.given.vin.map((v) => ({
        txid: v.txid,
        vout: v.vout,
        scriptPubKeyHex: v.prevout.scriptPubKey.hex,
        scriptSigHex: v.scriptSig,
        witness: parseWitness(v.txinwitness),
      }));

      const outputs: ScannableOutput[] = c.given.outputs.map((xonly, i) => ({
        txid: '0000000000000000000000000000000000000000000000000000000000000000',
        vout: i,
        value: 1000,
        scriptPubKeyHex: p2trScriptPubKeyFromXOnly(xonly),
      }));

      const scanPrivKey = hexToBytes(c.given.key_material.scan_priv_key);
      const spendPrivKey = hexToBytes(c.given.key_material.spend_priv_key);
      const spendPubKey = secp256k1.getPublicKey(spendPrivKey, true);

      const found = scanSilentPaymentTransaction(inputs, outputs, scanPrivKey, spendPubKey);

      expect(found).toHaveLength(c.expected.outputs.length);
      for (const expected of c.expected.outputs) {
        const match = found.find((f) => outputs[f.vout].scriptPubKeyHex === p2trScriptPubKeyFromXOnly(expected.pub_key));
        expect(match).toBeDefined();
      }
    },
  );

  it('stops scanning after the first non-matching k', () => {
    // Pick a multi-output case so we know the sender produced outputs for k=0
    // and k=1. If we remove the k=0 output, a correct scanner must return
    // nothing: BIP-352 stops deriving keys as soon as the current k does not
    // match any remaining output.
    const multi = cases.filter((c) => c.expected.outputs.length >= 2);
    if (multi.length === 0) throw new Error('No multi-output test vectors available');
    const c = multi[0];

    const inputs: ScannableInput[] = c.given.vin.map((v) => ({
      txid: v.txid,
      vout: v.vout,
      scriptPubKeyHex: v.prevout.scriptPubKey.hex,
      scriptSigHex: v.scriptSig,
      witness: parseWitness(v.txinwitness),
    }));

    const fullOutputs: ScannableOutput[] = c.given.outputs.map((xonly, i) => ({
      txid: '0000000000000000000000000000000000000000000000000000000000000000',
      vout: i,
      value: 1000,
      scriptPubKeyHex: p2trScriptPubKeyFromXOnly(xonly),
    }));

    const scanPrivKey = hexToBytes(c.given.key_material.scan_priv_key);
    const spendPrivKey = hexToBytes(c.given.key_material.spend_priv_key);
    const spendPubKey = secp256k1.getPublicKey(spendPrivKey, true);

    const fullFound = scanSilentPaymentTransaction(inputs, fullOutputs, scanPrivKey, spendPubKey);
    const k1Match = fullFound.find((f) => f.k === 1);
    expect(k1Match).toBeDefined();

    const onlyK1 = fullOutputs.filter((o) => o.vout === k1Match!.vout);
    const found = scanSilentPaymentTransaction(inputs, onlyK1, scanPrivKey, spendPubKey);
    expect(found).toHaveLength(0);
  });
});
