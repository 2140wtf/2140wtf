/**
 * Elements-domain taproot math (liquid rails).
 *
 * DISCOVERED ON-CHAIN (2026-09-13, liquid-claim.ts run): Elements does NOT
 * reuse Bitcoin's taproot tagged hashes. liquidjs-lib pins the domain:
 *
 *   - leaf version  TAPSCRIPT = 0xc4        (Bitcoin: 0xc0)
 *   - tagged hashes use 'TapLeaf/elements', 'TapBranch/elements',
 *     'TapTweak/elements' (Bitcoin: 'TapLeaf', 'TapBranch', 'TapTweak')
 *
 * Consequence: the "taproot math is chain-agnostic" assumption in
 * TESTNET4-RAIL-DESIGN.md is WRONG - a descriptor whose root/output key is
 * computed with Bitcoin tags is unspendable on Elements (the script-path
 * control-block commitment fails: 'Witness program hash mismatch'). Script
 * BYTES (keys, CLTV pushes, opcodes) are unaffected.
 *
 * This module re-derives ONLY the hash-domain-dependent pieces for liquid
 * rails; script construction stays in the shared builders (single source
 * of scripts, per the row-B2 canonicalization rule).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { liftX, hexToBytes, bytesToHex } from './testnet4Taproot.js';

/** Elements tapscript leaf version (liquidjs-lib bip341: 0xc4). */
export const LEAF_VERSION_ELEMENTS = 0xc4;

const taggedHashE = (tag: string, data: Uint8Array): Uint8Array => {
  const t = sha256(new TextEncoder().encode(tag));
  return sha256(new Uint8Array([...t, ...t, ...data]));
};

/** hash_TapLeaf over the ELEMENTS domain: version 0xc4 ‖ compactSize ‖ script. */
export function tapLeafHashE(script: Uint8Array, leafVersion = LEAF_VERSION_ELEMENTS): Uint8Array {
  if (leafVersion & 1) throw new Error('elements leaf version must be even (parity-free)');
  const cs = script.length < 0xfd ? Uint8Array.of(script.length) : (() => { throw new Error('script too large'); })();
  return taggedHashE('TapLeaf/elements', new Uint8Array([...Uint8Array.of(leafVersion), ...cs, ...script]));
}

export { tapLeafHashE as elementsTapLeafHash };

/** hash_TapBranch over the ELEMENTS domain, lexicographic ordering. */
export function tapBranchHashE(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [x, y] = bytesToHex(a) <= bytesToHex(b) ? [a, b] : [b, a];
  return taggedHashE('TapBranch/elements', new Uint8Array([...x, ...y]));
}

export type ETapTree =
  | { readonly script: Uint8Array; readonly leafVersion?: number }
  | { readonly l: ETapTree; readonly r: ETapTree };

export function taptreeRootE(tree: ETapTree): Uint8Array {
  if ('script' in tree) return tapLeafHashE(tree.script, tree.leafVersion ?? LEAF_VERSION_ELEMENTS);
  return tapBranchHashE(taptreeRootE(tree.l), taptreeRootE(tree.r));
}

/** Build the balanced tree EXACTLY like the shared walk (sorted, folded). */
export function treeFromLeavesE(leaves: ReadonlyArray<{ scriptHex: string; leafVersion: number }>): ETapTree {
  let level: ETapTree[] = leaves
    .slice()
    .sort((a, b) => (a.scriptHex < b.scriptHex ? -1 : 1))
    .map((l) => ({ script: hexToBytes(l.scriptHex), leafVersion: l.leafVersion }));
  if (level.length === 0) throw new Error('empty tree');
  while (level.length > 1) {
    const next: ETapTree[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(level[i + 1] ? { l: level[i], r: level[i + 1] } : level[i]);
    }
    level = next;
  }
  return level[0];
}

/** Sibling path nearest-first (control-block order), walked from the root. */
export function merklePathE(tree: ETapTree, targetScript: Uint8Array): Uint8Array[] {
  function walk(node: ETapTree): Uint8Array[] | null {
    if ('script' in node) {
      return bytesToHex(node.script) === bytesToHex(targetScript) ? [] : null;
    }
    const left = walk(node.l);
    if (left) return [...left, taptreeRootE(node.r)];
    const right = walk(node.r);
    if (right) return [...right, taptreeRootE(node.l)];
    return null;
  }
  const path = walk(tree);
  if (!path) throw new Error('target leaf not found in Elements tree');
  return path;
}

/** Output key under the ELEMENTS TapTweak tag. */
export function tweakOutputKeyE(internalXOnly: Uint8Array, merkleRoot: Uint8Array): Uint8Array {
  if (internalXOnly.length !== 32) throw new Error('internal key must be x-only 32B');
  const preimage = new Uint8Array([...internalXOnly, ...merkleRoot]);
  void preimage;
  // taggedHashE('TapTweak/elements', internal ‖ root)
  const t = taggedHashE('TapTweak/elements', new Uint8Array([...internalXOnly, ...merkleRoot]));
  const Q = liftX(internalXOnly).add(secp256k1.Point.BASE.multiply(bytesToBigInt(t)));
  return xOnlyE(Q);
}

export function tweakParityE(internalXOnly: Uint8Array, merkleRoot: Uint8Array): number {
  const t = taggedHashE('TapTweak/elements', new Uint8Array([...internalXOnly, ...merkleRoot]));
  const Q = liftX(internalXOnly).add(secp256k1.Point.BASE.multiply(bytesToBigInt(t)));
  return Number(Q.toAffine().y % 2n);
}

function bytesToBigInt(b: Uint8Array): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

function xOnlyE(point: ReturnType<typeof liftX>): Uint8Array {
  const { x } = point.toAffine();
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
