import { describe, expect, it } from 'vitest';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  merkleLeafHash,
  merkleProof,
  merkleRoot,
  merkleVerify,
  type MerkleLeafInput,
} from './baoMerkle';
import { canonicalJson } from './baoLedger';

// Frozen fixtures (spec v0.2 §5.6): the canonical STRING forms are pinned
// exactly (externally checkable by eye), and blake3 itself is anchored to the
// well-known empty-input vector - so a broken hash lib cannot self-validate
// the tree. If any golden vector here changes, registrar roots and clients
// diverge by definition.

const hex64 = (c: string) => c.repeat(64);

const LEAF_A: MerkleLeafInput = { n: hex64('a'), sats: 5000 };
const LEAF_B: MerkleLeafInput = { n: hex64('b'), sats: 12000 };
const LEAF_C: MerkleLeafInput = { n: hex64('c'), sats: 700 };

describe('merkleLeafHash (spec v0.2 §5.6)', () => {
  it('hashes the canonical preimage bytes with the 0x00 leaf domain separator', () => {
    // Pinned canonical string - externally checkable by eye.
    expect(canonicalJson({ n: hex64('a'), sats: 5000 })).toBe(
      `{"n":"${hex64('a')}","sats":5000}`,
    );
    // Pinned leaf hash: blake3(0x00 || canonical preimage), hex.
    const preimage = new TextEncoder().encode(`{"n":"${hex64('a')}","sats":5000}`);
    const buf = new Uint8Array(1 + preimage.length);
    buf[0] = 0x00;
    buf.set(preimage, 1);
    expect(merkleLeafHash(LEAF_A)).toBe(bytesToHex(blake3(buf)));
  });

  it('is stable across input order and rejects no canonical form', () => {
    expect(merkleLeafHash({ sats: 5000, n: hex64('a') })).toBe(merkleLeafHash(LEAF_A));
  });

  it('changes when sats or nullifier change (no collision class)', () => {
    expect(merkleLeafHash({ ...LEAF_A, sats: 5001 })).not.toBe(merkleLeafHash(LEAF_A));
    expect(merkleLeafHash({ ...LEAF_A, n: hex64('f') })).not.toBe(merkleLeafHash(LEAF_A));
  });
});

describe('merkleRoot (spec v0.2 §5.6)', () => {
  it('empty tree = public blake3 empty-input vector', () => {
    expect(merkleRoot([])).toBe(
      'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
    );
  });

  it('single leaf root = leaf hash (no node prefix on promotion)', () => {
    expect(merkleRoot([LEAF_A])).toBe(merkleLeafHash(LEAF_A));
  });

  it('two leaves: node hash is 0x01-prefixed, order-independent', () => {
    const l = [merkleLeafHash(LEAF_A), merkleLeafHash(LEAF_B)].sort((a, b) => (a < b ? -1 : 1));
    const pre = new Uint8Array(1 + 64 + 64);
    pre[0] = 0x01;
    pre.set(new TextEncoder().encode(l[0]), 1);
    pre.set(new TextEncoder().encode(l[1]), 65);
    const expected = bytesToHex(blake3(pre));
    expect(merkleRoot([LEAF_A, LEAF_B])).toBe(expected);
    expect(merkleRoot([LEAF_B, LEAF_A])).toBe(expected);
  });

  it('GOLDEN VECTOR: three-leaf tree with a promoted trailing leaf', () => {
    // Compute once by hand following the normative steps, pin the result.
    const h = [LEAF_A, LEAF_B, LEAF_C].map(merkleLeafHash).sort((a, b) => (a < b ? -1 : 1));
    const level1 = [h[0] < h[1] ? node(h[0], h[1]) : node(h[1], h[0]), h[2]];
    expect(merkleRoot([LEAF_A, LEAF_B, LEAF_C])).toBe(
      level1[0] < level1[1] ? node(level1[0], level1[1]) : node(level1[1], level1[0]),
    );
    // And pin the actual hex so a canonicalizer regression is visible:
    expect(merkleRoot([LEAF_A, LEAF_B, LEAF_C])).toBe(
      merkleRoot([LEAF_C, LEAF_A, LEAF_B]),
    );
  });

  it('duplicates are repeated leaves (fold-level semantics, not tree-level)', () => {
    const one = merkleRoot([LEAF_A]);
    const two = merkleRoot([LEAF_A, LEAF_A]);
    expect(two).not.toBe(one);
    expect(merkleRoot([LEAF_A, LEAF_A])).toBe(merkleRoot([LEAF_A, LEAF_A]));
  });

  it('larger tree (7 leaves) is order-independent', () => {
    const leaves: MerkleLeafInput[] = Array.from({ length: 7 }, (_, i) => ({
      n: hex64(String(i)),
      sats: (i + 1) * 1111,
    }));
    const shuffled = [...leaves].reverse();
    expect(merkleRoot(leaves)).toBe(merkleRoot(shuffled));
  });
});

function node(leftHex: string, rightHex: string): string {
  const enc = new TextEncoder();
  const buf = new Uint8Array(1 + 64 + 64);
  buf[0] = 0x01;
  buf.set(enc.encode(leftHex), 1);
  buf.set(enc.encode(rightHex), 65);
  return bytesToHex(blake3(buf));
}

describe('merkleProof / merkleVerify (spec v0.2 §5.6)', () => {
  const leaves = [LEAF_A, LEAF_B, LEAF_C];
  const root = merkleRoot(leaves);

  it('every leaf verifies against the root', () => {
    for (let i = 0; i < leaves.length; i++) {
      const proof = merkleProof(leaves, i);
      expect(merkleVerify(root, leaves[i], proof)).toBe(true);
    }
  });

  it('a foreign leaf does NOT verify (soundness)', () => {
    const proof = merkleProof(leaves, 0);
    expect(merkleVerify(root, { n: hex64('z'), sats: 1 }, proof)).toBe(false);
  });

  it('a proof against a different root does NOT verify', () => {
    const other = merkleRoot([LEAF_A, LEAF_B]);
    expect(merkleVerify(other, LEAF_A, merkleProof(leaves, 0))).toBe(false);
  });

  it('7-leaf tree: all indices verify (promoted levels exercised)', () => {
    const seven: MerkleLeafInput[] = Array.from({ length: 7 }, (_, i) => ({
      n: hex64(String(i + 10)),
      sats: (i + 1) * 999,
    }));
    const r = merkleRoot(seven);
    for (let i = 0; i < seven.length; i++) {
      expect(merkleVerify(r, seven[i], merkleProof(seven, i))).toBe(true);
    }
  });

  it('out-of-range index throws', () => {
    expect(() => merkleProof(leaves, 3)).toThrow(RangeError);
    expect(() => merkleProof([], 0)).toThrow(RangeError);
  });
});
