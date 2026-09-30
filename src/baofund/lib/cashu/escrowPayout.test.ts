import { beforeEach, describe, expect, it, vi } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { Amount, hashToCurve } from '@cashu/cashu-ts';

import {
  adoptEscrowPayout,
  listEscrowPayouts,
  parseEscrowPayoutSignatures,
  recoverEscrowPayout,
  removeEscrowPayout,
  saveEscrowPayout,
  unblindEscrowPayoutProofs,
  type EscrowPayoutKeyset,
  type EscrowPayoutRecord,
} from './escrowPayout';
import type { EscrowSwapOutputWire } from './escrowSwapComplete';

const PUBKEY = 'ab'.repeat(32);
const KEYSET_ID = '00deadbeef00';

/** One output + its blind signature built by REVERSE-unblinding: choose the
 *  expected proof point C, random blinding r and mint key K, then
 *  C_ = C + r·K and B_ = Y + r·G. The unblind must recover C. */
function fixture(secret: string, amount: number, r: bigint, k: bigint, keysetId = KEYSET_ID) {
  const secretBytes = new TextEncoder().encode(secret);
  const Y = hashToCurve(secretBytes);
  const C = Y.multiply(0x1234n);
  const K = secp256k1.Point.BASE.multiply(k);
  const B_ = Y.add(secp256k1.Point.BASE.multiply(r));
  const C_ = C.add(K.multiply(r));
  const output: EscrowSwapOutputWire = {
    blindedMessage: { amount, B_: B_.toHex(true), id: keysetId },
    blindingFactor: r.toString(16).padStart(64, '0'),
    secret: bytesToHex(secretBytes),
  };
  const keyset: EscrowPayoutKeyset = { id: keysetId, keys: { [String(amount)]: K.toHex(true) } };
  return { output, keyset, expectedC: C.toHex(true), C_: C_.toHex(true) };
}

function record(over: Partial<EscrowPayoutRecord> = {}): EscrowPayoutRecord {
  return {
    v: 1,
    kind: 'release',
    frId: 'fr_1',
    milestoneId: 'm1',
    mint: 'https://mint.example.com',
    amountSats: 128,
    token: 'cashuBtoken',
    createdAt: 1,
    ...over,
  };
}

beforeEach(() => localStorage.clear());

describe('parseEscrowPayoutSignatures', () => {
  it('returns null for an absent payload (older API) and lowers the C_ hex', () => {
    expect(parseEscrowPayoutSignatures(undefined)).toBeNull();
    expect(parseEscrowPayoutSignatures(null)).toBeNull();
    const parsed = parseEscrowPayoutSignatures([{ amount: 8, C_: '02' + 'AB'.repeat(32), id: 'x' }]);
    expect(parsed).toEqual([{ amount: 8, C_: '02' + 'ab'.repeat(32), id: 'x' }]);
  });

  it('throws on anything malformed instead of partially trusting it', () => {
    expect(() => parseEscrowPayoutSignatures('nope')).toThrow(/malformed swap_signatures/);
    expect(() => parseEscrowPayoutSignatures([{ amount: 0, C_: '02' + 'ab'.repeat(32) }])).toThrow(/malformed swap signature/);
    expect(() => parseEscrowPayoutSignatures([{ amount: 8, C_: 'not-hex' }])).toThrow(/malformed swap signature/);
    expect(() => parseEscrowPayoutSignatures([null])).toThrow(/malformed swap signature/);
  });
});

describe('unblindEscrowPayoutProofs', () => {
  it('unblinds every output into the expected proof', () => {
    const a = fixture('secret-a', 128, 0x1111n, 0x2222n, '00aaa111');
    const b = fixture('secret-b', 22, 0x3333n, 0x4444n, '00bbb222');
    const proofs = unblindEscrowPayoutProofs(
      [a.output, b.output],
      [{ amount: 128, C_: a.C_ }, { amount: 22, C_: b.C_ }],
      [a.keyset, b.keyset],
    );
    // cashu-ts 4.x Proof.amount is an Amount; the payout amount is numeric.
    expect(proofs.map((p) => Amount.from(p.amount).toNumber())).toEqual([128, 22]);
    expect(proofs[0].C).toBe(a.expectedC);
    expect(proofs[1].C).toBe(b.expectedC);
    expect(proofs[0].secret).toBe('secret-a');
  });

  it('fails closed on a signature count mismatch, amount drift, keyset mismatch, or missing key', () => {
    const f = fixture('secret-a', 128, 0x1111n, 0x2222n);
    const sig = { amount: 128, C_: f.C_ };
    expect(() => unblindEscrowPayoutProofs([f.output], [], [f.keyset])).toThrow(/no mint signature|0 mint signature/);
    expect(() => unblindEscrowPayoutProofs([f.output], [{ ...sig, amount: 1 }], [f.keyset])).toThrow(/signature 0 is for 1 sats/);
    expect(() => unblindEscrowPayoutProofs([f.output], [{ ...sig, id: 'other' }], [f.keyset])).toThrow(/keyset does not match/);
    const noKey: EscrowPayoutKeyset = { id: KEYSET_ID, keys: { '64': f.keyset.keys['128'] } };
    expect(() => unblindEscrowPayoutProofs([f.output], [sig], [noKey])).toThrow(/has no key for a 128-sat payout/);
  });
});

describe('escrow payout journal', () => {
  it('stores per identity, dedupes by campaign+milestone, and drops on remove', () => {
    expect(saveEscrowPayout(PUBKEY, record())).toBe(true);
    expect(saveEscrowPayout(PUBKEY, record({ token: 'cashuBnew' }))).toBe(true);
    const rows = listEscrowPayouts(PUBKEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe('cashuBnew');
    removeEscrowPayout(PUBKEY, 'fr_1', 'm1');
    expect(listEscrowPayouts(PUBKEY)).toHaveLength(0);
  });

  it('scopes slots to the identity and ignores invalid pubkeys', () => {
    expect(saveEscrowPayout(PUBKEY, record())).toBe(true);
    expect(listEscrowPayouts('cd'.repeat(32))).toHaveLength(0);
    expect(saveEscrowPayout('not-a-pubkey', record())).toBe(false);
    expect(listEscrowPayouts(null)).toHaveLength(0);
    // Case-insensitive pubkey normalization.
    expect(listEscrowPayouts(PUBKEY.toUpperCase())).toHaveLength(1);
  });

  it('degrades corrupt storage to an empty list, never a throw', () => {
    localStorage.setItem(`baofund:escrow-payouts:${PUBKEY}`, '{not json');
    expect(listEscrowPayouts(PUBKEY)).toEqual([]);
    localStorage.setItem(`baofund:escrow-payouts:${PUBKEY}`, JSON.stringify([{ v: 1, token: '' }]));
    expect(listEscrowPayouts(PUBKEY)).toEqual([]);
  });
});

describe('recoverEscrowPayout', () => {
  const f = fixture('secret-a', 128, 0x1111n, 0x2222n);

  it('journals first, adopts into the wallet, and clears the journal entry', async () => {
    const observed: string[] = [];
    const adopt = vi.fn(async (token: string, opts: { privkey?: string }) => {
      // The journal entry must exist BEFORE adoption runs (crash safety).
      expect(listEscrowPayouts(PUBKEY)).toHaveLength(1);
      observed.push(`${token}:${opts.privkey ?? 'none'}`);
    });
    const res = await recoverEscrowPayout({
      kind: 'release',
      frId: 'fr_1',
      milestoneId: 'm1',
      mint: 'https://mint.example.com',
      expectedPayoutSats: 128,
      outputs: [f.output],
      signatures: [{ amount: 128, C_: f.output.blindedMessage.B_ }],
      identityPubkey: PUBKEY,
      identityHex: 'aa'.repeat(32),
      fetchKeys: async () => [f.keyset],
      adopt,
    });
    expect(res.stored).toBe('wallet');
    expect(res.amountSats).toBe(128);
    expect(adopt).toHaveBeenCalledTimes(1);
    expect(observed[0]).toContain('aa'.repeat(32));
    expect(listEscrowPayouts(PUBKEY)).toHaveLength(0);
  });

  it('keeps the journaled token when the wallet receive fails', async () => {
    const res = await recoverEscrowPayout({
      kind: 'refund',
      frId: 'fr_9',
      milestoneId: 'm9',
      mint: 'https://mint.example.com',
      expectedPayoutSats: 128,
      outputs: [f.output],
      signatures: [{ amount: 128, C_: f.output.blindedMessage.B_ }],
      identityPubkey: PUBKEY,
      identityHex: null,
      fetchKeys: async () => [f.keyset],
      adopt: async () => { throw new Error('mint unreachable'); },
    });
    expect(res.stored).toBe('journal');
    const rows = listEscrowPayouts(PUBKEY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'refund', frId: 'fr_9', milestoneId: 'm9', amountSats: 128 });
  });

  it('fails closed when the payout cannot even be journaled and adoption fails', async () => {
    await expect(recoverEscrowPayout({
      kind: 'release',
      frId: 'fr_1',
      milestoneId: 'm1',
      mint: 'https://mint.example.com',
      expectedPayoutSats: 128,
      outputs: [f.output],
      signatures: [{ amount: 128, C_: f.output.blindedMessage.B_ }],
      identityPubkey: null,
      fetchKeys: async () => [f.keyset],
      adopt: async () => { throw new Error('mint unreachable'); },
    })).rejects.toThrow(/NOT saved/);
  });

  it('refuses a recovered total that does not match the expected payout', async () => {
    await expect(recoverEscrowPayout({
      kind: 'release',
      frId: 'fr_1',
      milestoneId: 'm1',
      mint: 'https://mint.example.com',
      expectedPayoutSats: 999,
      outputs: [f.output],
      signatures: [{ amount: 128, C_: f.output.blindedMessage.B_ }],
      identityPubkey: PUBKEY,
      fetchKeys: async () => [f.keyset],
      adopt: async () => undefined,
    })).rejects.toThrow(/recovered payout is 128 sats, expected 999/);
  });
});

describe('adoptEscrowPayout', () => {
  it('removes the journal entry only on a successful receive', async () => {
    saveEscrowPayout(PUBKEY, record());
    const [row] = listEscrowPayouts(PUBKEY);
    expect(await adoptEscrowPayout(PUBKEY, row, null, async () => undefined)).toBe(true);
    expect(listEscrowPayouts(PUBKEY)).toHaveLength(0);

    saveEscrowPayout(PUBKEY, record());
    const [row2] = listEscrowPayouts(PUBKEY);
    expect(await adoptEscrowPayout(PUBKEY, row2, null, async () => { throw new Error('no'); })).toBe(false);
    expect(listEscrowPayouts(PUBKEY)).toHaveLength(1);
  });
});
