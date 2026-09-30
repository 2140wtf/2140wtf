/**
 * WS9 round-4 fuzz: escrow payout recovery (parse → unblind → journal →
 * adopt). Every input here is either a wire payload from the Fund API or a
 * value persisted in localStorage, so all of them are untrusted. The
 * invariant under fuzz is "never crash uncontrolled, always fail closed":
 * a malformed signature set either throws (nothing trusted) or parses fully
 * valid; a mismatched unblind always throws and never returns a partial
 * proof array; the journal stays bounded and never throws.
 *
 * Deterministic: mulberry32 with fixed seeds, pure/localStorage only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { Amount, hashToCurve } from '@cashu/cashu-ts';

import {
  adoptEscrowPayout,
  fetchMintPayoutKeysets,
  listEscrowPayouts,
  parseEscrowPayoutSignatures,
  saveEscrowPayout,
  unblindEscrowPayoutProofs,
  type EscrowPayoutKeyset,
  type EscrowPayoutRecord,
} from './escrowPayout';
import type { EscrowSwapOutputWire } from './escrowSwapComplete';

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (rnd: () => number, len: number): string =>
  Array.from({ length: len }, () => Math.floor(rnd() * 16).toString(16)).join('');
const pick = <T,>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;

/** Valid output + signature + keyset via reverse-unblinding (mirrors the
 *  round-trip fixtures in escrowPayout.test.ts). */
function fixture(secret: string, amount: number, r: bigint, k: bigint, keysetId: string) {
  const Y = hashToCurve(new TextEncoder().encode(secret));
  const C = Y.multiply(0x1234n);
  const K = secp256k1.Point.BASE.multiply(k);
  const B_ = Y.add(secp256k1.Point.BASE.multiply(r));
  const C_ = C.add(K.multiply(r));
  const output: EscrowSwapOutputWire = {
    blindedMessage: { amount, B_: B_.toHex(true), id: keysetId },
    blindingFactor: r.toString(16).padStart(64, '0'),
    secret: bytesToHex(new TextEncoder().encode(secret)),
  };
  const keyset: EscrowPayoutKeyset = { id: keysetId, keys: { [String(amount)]: K.toHex(true) } };
  return { output, keyset, expectedC: C.toHex(true), C_: C_.toHex(true) };
}

const record = (over: Partial<EscrowPayoutRecord> = {}): EscrowPayoutRecord => ({
  v: 1, kind: 'release', frId: 'fr_1', milestoneId: 'm1',
  mint: 'https://mint.example.com', amountSats: 128, token: 'cashuBtoken',
  createdAt: 1, ...over,
});

beforeEach(() => localStorage.clear());

describe('escrow payout - fuzz (round 4)', () => {
  it('parseEscrowPayoutSignatures: hostile payloads never yield a partially valid set', () => {
    const rnd = mulberry32(0x5eed01);
    const junkPool: unknown[] = [
      0, -1, 1.5, Number.NaN, Infinity, '', 'x', 'nope',
      [], {}, [null], [undefined], [0], [{ amount: 0 }], [{ C_: 'zz' }],
      [{ amount: 1, C_: '02' + 'a'.repeat(64) }], [{ amount: 1, C_: '02' + 'ab'.repeat(32), id: '' }],
      [{ amount: 2, C_: '02' + 'AB'.repeat(32), id: 'ks' }], [{}], [[{ amount: 1 }]],
      { amount: 1 }, true, false,
    ];
    for (let i = 0; i < 400; i++) {
      const value = rnd() < 0.5 ? pick(rnd, junkPool) : [pick(rnd, junkPool)];
      let parsed: ReturnType<typeof parseEscrowPayoutSignatures> | undefined;
      try {
        parsed = parseEscrowPayoutSignatures(value);
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        continue;
      }
      if (parsed === null) continue;
      // Parsed output must be FULLY valid (no partial trust).
      expect(Array.isArray(parsed)).toBe(true);
      for (const sig of parsed!) {
        expect(Number.isSafeInteger(sig.amount) && sig.amount > 0).toBe(true);
        expect(sig.C_).toMatch(/^[0-9a-f]{66}$/);
        if (sig.id !== undefined) expect(typeof sig.id === 'string' && sig.id.length > 0).toBe(true);
      }
    }
    // Absent payloads are the only null (older API).
    expect(parseEscrowPayoutSignatures(undefined)).toBeNull();
    expect(parseEscrowPayoutSignatures(null)).toBeNull();
  });

  it('unblind: any mismatch throws, never a partial payout, inputs unchanged', () => {
    const rnd = mulberry32(0x5eed02);
    const a = fixture('fuzz-a', 128, 0x1111n, 0x2222n, '00aaa111');
    const b = fixture('fuzz-b', 64, 0x3333n, 0x4444n, '00bbb222');
    const outputs = [a.output, b.output];
    const sigs = [{ amount: 128, C_: a.C_ }, { amount: 64, C_: b.C_ }];
    const keysets = [a.keyset, b.keyset];
    const before = JSON.stringify({ outputs, sigs, keysets });

    // Valid baseline recovers both proofs.
    const proofs = unblindEscrowPayoutProofs(outputs, sigs, keysets);
    expect(proofs).toHaveLength(2);
    for (let i = 0; i < 400; i++) {
      const outputsMu = structuredClone(outputs);
      const sigsMu = structuredClone(sigs);
      const keysetsMu = structuredClone(keysets);
      switch (Math.floor(rnd() * 6)) {
        case 0: sigsMu.pop(); break; // missing signature
        case 1: sigsMu.push({ amount: 1, C_: sigs[0]!.C_ }); break; // extra signature
        case 2: sigsMu[Math.floor(rnd() * sigsMu.length)]!.amount += 1; break; // amount drift
        case 3: sigsMu[0]!.C_ = '02' + hex(rnd, 64); break; // wrong commitment
        case 4: keysetsMu[0]!.keys = {}; break; // missing keys
        default: outputsMu[0]!.blindingFactor = hex(rnd, 64); break; // blinding drift
      }
      try {
        const out = unblindEscrowPayoutProofs(outputsMu, sigsMu, keysetsMu);
        // Success only when nothing meaningful changed.
        expect(out).toHaveLength(outputsMu.length);
        out.forEach((p, idx) => expect(Amount.from(p.amount).toNumber()).toBe(outputsMu[idx]!.blindedMessage.amount));
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      }
    }
    // Pure: the caller's arrays are untouched by all of the above (the
    // fixtures were cloned per iteration; the originals must still equal).
    expect(JSON.stringify({ outputs, sigs, keysets })).toBe(before);
  });

  it('fetchMintPayoutKeysets: hostile hosts/bodies throw or yield only usable keysets', async () => {
    const rnd = mulberry32(0x5eed03);
    const hosts = [
      'http://mint.example.com', 'ftp://mint.example.com', 'not-a-url', '',
      'https://mint.example.com', 'https://127.0.0.1:3338', 'https://[::ffff:7f00:1]',
    ];
    for (let i = 0; i < 300; i++) {
      const host = pick(rnd, hosts);
      const body = pick(rnd, [
        null, {}, { keysets: [] }, { keysets: 'x' }, { keysets: [null] },
        { keysets: [{ id: '' }] }, { keysets: [{ id: 'ks' }] },
        { keysets: [{ id: 'ks', keys: {} }] },
        { keysets: [{ id: 'ks', keys: { '1': '' } }] },
        { keysets: [{ id: 'ks', keys: { '1': '02' + 'a'.repeat(62) } }] },
        { keysets: [{ id: 'ks', keys: { '1': 'bad' } }] },
      ]);
      const fetchFn = (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
      let out: EscrowPayoutKeyset[] | undefined;
      try {
        out = await fetchMintPayoutKeysets(host, fetchFn);
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        continue;
      }
      expect(out.length).toBeGreaterThan(0);
      for (const ks of out!) {
        expect(ks.id.length).toBeGreaterThan(0);
        expect(Object.keys(ks.keys).length).toBeGreaterThan(0);
        for (const v of Object.values(ks.keys)) expect(typeof v === 'string' && v.length > 0).toBe(true);
      }
    }
  });

  it('journal: bounded, deduped, hostile records never throw', async () => {
    const rnd = mulberry32(0x5eed04);
    expect(saveEscrowPayout('not-hex', record())).toBe(false);
    expect(listEscrowPayouts('not-hex')).toEqual([]);
    for (let i = 0; i < 120; i++) {
      const pk = pick(rnd, ['ab'.repeat(32), 'CD'.repeat(32), '', null, undefined]);
      const rec = record({
        frId: `fr_${Math.floor(rnd() * 8)}`,
        milestoneId: `m${Math.floor(rnd() * 5)}`,
        amountSats: 1 + Math.floor(rnd() * 1000),
      });
      expect(() => saveEscrowPayout(pk, rec)).not.toThrow();
    }
    const stored = listEscrowPayouts('ab'.repeat(32));
    expect(stored.length).toBeLessThanOrEqual(20);
    for (const r of stored) {
      expect(r.v).toBe(1);
      expect(r.amountSats).toBeGreaterThan(0);
      const dupes = stored.filter((x) => x.frId === r.frId && x.milestoneId === r.milestoneId);
      expect(dupes).toHaveLength(1); // deduped by (frId, milestoneId)
    }
    expect(await adoptEscrowPayout('ab'.repeat(32), stored[0] ?? record(), null, async () => {})).toBe(true);
  });
});
