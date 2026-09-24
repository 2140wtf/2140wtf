/**
 * Bao escrow Merkle accumulator - implements the normative spec v0.2 §5.6
 * "Merkle accumulator for committed counts" (fresh-eyes A-3).
 *
 * Normative definition (docs/bao-normative-spec-v0.md):
 * - Leaf preimage = canonical JSON bytes (§1.5) of
 *     { n: <nullifier hex>, sats: <contribution sats, integer> }
 * - Leaf hash     = blake3(0x00 || leafPreimage)          (domain-separated)
 * - Internal hash = blake3(0x01 || leftHash || rightHash)
 * - Leaves sorted ascending by leaf hash; an odd trailing leaf is promoted
 *   (unpaired) at each level; empty tree root = blake3 of the empty byte
 *   string (the public blake3 empty-input vector).
 *
 * Domain separators 0x00/0x01 prevent leaf-vs-node ambiguity. Two
 * implementations that build different roots from the same contribution set
 * are buggy - golden vectors for this tree are a C-suite fixture (spec §5.6,
 * conformance week-1 list).
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { canonicalJson } from './baoLedger';

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

/** One contribution in the committed count set. */
export interface MerkleLeafInput {
  /** Per-campaign nullifier, lowercase hex (spec §3). */
  n: string;
  /** Contribution amount in sats - integer end-to-end (spec §1.5). */
  sats: number;
}

/** blake3 over the canonical JSON bytes of the leaf preimage, prefixed. */
export function merkleLeafHash(leaf: MerkleLeafInput): string {
  const preimage = utf8ToBytes(canonicalJson({ n: leaf.n, sats: leaf.sats }));
  const buf = new Uint8Array(LEAF_PREFIX.length + preimage.length);
  buf.set(LEAF_PREFIX, 0);
  buf.set(preimage, LEAF_PREFIX.length);
  return bytesToHex(blake3(buf));
}

function nodeHash(leftHex: string, rightHex: string): string {
  const l = utf8ToBytes(leftHex);
  const r = utf8ToBytes(rightHex);
  const buf = new Uint8Array(NODE_PREFIX.length + l.length + r.length);
  buf.set(NODE_PREFIX, 0);
  buf.set(l, NODE_PREFIX.length);
  buf.set(r, NODE_PREFIX.length + l.length);
  return bytesToHex(blake3(buf));
}

/** Sort ascending by UTF-8 bytes of the lowercase-hex hash (stable, total). */
function byHashHex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Root of the commitment tree. `leaves` may be in any order (canonical
 * sorting applies); duplicates are the caller's semantics (a repeated
 * nullifier IS a repeated leaf - sybil detection happens at the fold, not
 * here). Empty set yields the public blake3 empty-input vector.
 */
export function merkleRoot(leaves: MerkleLeafInput[]): string {
  if (leaves.length === 0) {
    return bytesToHex(blake3(new Uint8Array(0)));
  }
  let level = leaves.map(merkleLeafHash).sort(byHashHex);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(nodeHash(level[i], level[i + 1]));
    }
    // Odd trailing leaf is promoted unpaired (spec §5.6 v0.2).
    if (level.length % 2 === 1) {
      next.push(level[level.length - 1]);
    }
    level = next;
  }
  return level[0];
}

/** Inclusion proof for one leaf of the input set. */
export interface MerkleProof {
  /** Position of this leaf in the canonical (hash-sorted) leaf list. */
  index: number;
  /** Leaf hash this proof commits to. */
  leafHash: string;
  /** Sibling hashes bottom-up; `null` = promoted (unpaired) level. */
  siblings: Array<string | null>;
}

/**
 * Build an inclusion proof. `index` addresses the INPUT array (caller's
 * ordering); the leaf's canonical position in the hash-sorted list is
 * resolved internally. Duplicate leaf hashes verify identically (same
 * preimage), so first-match resolution is sound.
 */
export function merkleProof(leaves: MerkleLeafInput[], index: number): MerkleProof {
  if (leaves.length === 0 || index < 0 || index >= leaves.length) {
    throw new RangeError('merkleProof: index out of range');
  }
  const leafHash = merkleLeafHash(leaves[index]);
  const sorted = leaves.map(merkleLeafHash).sort(byHashHex);
  const sortedPos = sorted.indexOf(leafHash);
  if (sortedPos < 0) throw new RangeError('merkleProof: leaf not found (unreachable)');
  const siblings: Array<string | null> = [];
  let level = sorted;
  let pos = sortedPos;
  while (level.length > 1) {
    if (pos % 2 === 0) {
      // Right sibling exists unless we are the promoted trailing leaf.
      siblings.push(pos + 1 < level.length ? level[pos + 1] : null);
    } else {
      siblings.push(level[pos - 1]);
    }
    const next: string[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(nodeHash(level[i], level[i + 1]));
    }
    if (level.length % 2 === 1) {
      next.push(level[level.length - 1]);
    }
    level = next;
    pos = Math.floor(pos / 2);
  }
  return { index: sortedPos, leafHash, siblings };
}

/** Verify an inclusion proof against a root. */
export function merkleVerify(
  root: string,
  leaf: MerkleLeafInput,
  proof: MerkleProof,
): boolean {
  if (merkleLeafHash(leaf) !== proof.leafHash) return false;
  let hash = proof.leafHash;
  let pos = proof.index;
  for (const sib of proof.siblings) {
    if (sib === null) {
      // Promoted leaf: hash carries upward unchanged, position halves.
    } else if (pos % 2 === 0) {
      hash = nodeHash(hash, sib);
    } else {
      hash = nodeHash(sib, hash);
    }
    pos = Math.floor(pos / 2);
  }
  return hash === root;
}
