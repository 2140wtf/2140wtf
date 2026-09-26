/**
 * Testnet4 rail step 2 - tapscript leaf builders, taptree math and P2TR
 * output computation (docs/TESTNET4-RAIL-DESIGN.md §6 step 2).
 *
 * FULL Angor-parity leaf set per the owner's amendment ("do not drop
 * anything; make testnet as close to mainnet as possible"): founder-claim
 * stages, donor CLTV refund, founder pre-signed penalty (2-of-2 + CSV),
 * lead-investor hashlock threshold branches, and end-of-project expiry.
 *
 * Mainnet parity principle: every network-specific value (HRP, genesis
 * anchor, locktimes, thresholds) lives in ONE network-parameters object
 * (§4); moving to mainnet later is supplying a different parameter object,
 * never a code rewrite. The rail id stays btc-testnet4 until that object
 * is mainnet and the design is re-reviewed.
 *
 * Crypto basis (verified against the embedded BIP-341 wallet test vectors):
 *  - tweak = tagged_hash("TapTweak", x-only-internal ‖ merkle-root?) as a
 *    scalar; output key = lift_x(internal) + tweak·G, x-only serialized.
 *  - tapleaf hash = tagged_hash("TapLeaf", leafVersion ‖ compactSize(script));
 *    branch hash = tagged_hash("TapBranch", a ‖ b) in lexicographic order;
 *    merkle root = single leaf's hash when the tree has one leaf.
 *  - lift_x: given x-only key, y is the even root (BIP-341 §2.1.3);
 *    secp256k1 p ≡ 3 (mod 4) so y = (x³+7)^((p+1)/4) mod p, then negate to
 *    even if needed. Done with pure bigint modpow (no field lib needed).
 *
 * NUMS internal key: H = lift_x(0x50929b74c1a04954b78b4b6035e97a5e078a5a0f
 * 28ec96d547bfee9ace803ac0) - the G·(1/2) point agreed in the taproot
 * community; the discrete log is unknown to this implementation (and to
 * us), which is what makes the keypath provably unspendable. It is a
 * CONSTANT with provenance, never generated.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex as bytesToHexLib, hexToBytes as hexToBytesLib } from '@noble/hashes/utils.js';
import { bech32m } from '@scure/base';
import { BTC_TESTNET4_GENESIS_HASH } from './testnet4Rail';

export class TaprootRailError extends Error {
  readonly code: string;
  readonly detail: string;
  constructor(code: string, detail: string) {
    super(`taproot rail: ${code}: ${detail}`);
    this.name = 'TaprootRailError';
    this.code = code;
    this.detail = detail;
  }
}

// ── Bytes helpers ────────────────────────────────────────────────────────────

/*
 * SINGLE BYTE-CODEC RULE (v1 incident, 2026-09-13): these are the ONLY hex
 * codecs the rail uses. Both delegate to @noble/hashes - no hand-rolled
 * nibble math anywhere (v1's `slice(i*2, i+2)` typo silently corrupted
 * every byte after the first and burned the first tester identities).
 * The typed `bad_hex` domain is preserved over the library primitives.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new TaprootRailError('bad_hex', 'expected an even-length hex string');
  }
  return hexToBytesLib(hex);
}

export function bytesToHex(b: Uint8Array): string {
  return bytesToHexLib(b);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function equals(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** BIP-340 tagged hash: SHA256(SHA256(tag) ‖ SHA256(tag) ‖ data). */
export function taggedHash(tag: string, data: Uint8Array): Uint8Array {
  const t = sha256(new TextEncoder().encode(tag));
  return sha256(concat(t, t, data));
}

/** Bitcoin compact size (BIP-144 varint encoding). */
export function compactSize(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0) throw new TaprootRailError('bad_size', 'compactSize needs a non-negative integer');
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, (n >> 8) & 0xff);
  if (n <= 0xffffffff) return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
  throw new TaprootRailError('bad_size', 'compactSize > 2^32 unsupported');
}

/** Minimal CScriptNum encoding (BIP-62 rule 4) - what OP_CHECKLOCKTIMEVERIFY pops. */
export function scriptNum(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new TaprootRailError('bad_locktime', 'script number must be a uint32');
  }
  if (n === 0) return new Uint8Array(0);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.push(v & 0xff);
    v >>= 8;
  }
  // BIP-62: sign bit must be clear for positives; strip trailing zero unless
  // the next byte's high bit is set (needs the sign bit slot).
  if ((bytes[bytes.length - 1] & 0x80) !== 0) bytes.push(0);
  return Uint8Array.from(bytes);
}

// ── Field math: lift_x over secp256k1 (p ≡ 3 mod 4) ─────────────────────────

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const EXP = (P + 1n) / 4n; // since p % 4 === 3, this is the sqrt exponent

/** lift_x per BIP-341: y = sqrt(x³+7), pick even. Throws on non-square x. */
export function liftX(xOnly: Uint8Array) {
  if (xOnly.length !== 32) throw new TaprootRailError('bad_key', 'x-only key must be 32 bytes');
  let x = 0n;
  for (const b of xOnly) x = (x << 8n) | BigInt(b);
  if (x >= P) throw new TaprootRailError('bad_key', 'x not a field element (x ≥ p)');
  const ySq = (modPow(x, 3n, P) + 7n) % P;
  let y = modPow(ySq, EXP, P);
  if ((y * y) % P !== ySq) throw new TaprootRailError('bad_key', 'x is not on the curve (no sqrt exists)');
  if (y % 2n !== 0n) y = P - y;
  const point = secp256k1.Point.fromAffine({ x, y });
  return point;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** x-only serialization of a point (even-y, BIP-340). */
export function xOnly(point: ReturnType<typeof liftX>): Uint8Array {
  const { x } = point.toAffine();
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

// ── Taptree math (BIP-341) ───────────────────────────────────────────────────

export const LEAF_VERSION_BASE = 0xc0; // tapscript (BIP-342)

/** hash_TapLeaf(leafVersion ‖ compactSize(script) ‖ script). */
export function tapLeafHash(script: Uint8Array, leafVersion = LEAF_VERSION_BASE): Uint8Array {
  return taggedHash('TapLeaf', concat(Uint8Array.of(leafVersion), compactSize(script.length), script));
}

/** hash_TapBranch of two child hashes, ordered lexicographically. */
export function tapBranchHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  return equals(a, b) || bytesToHex(a) < bytesToHex(b)
    ? taggedHash('TapBranch', concat(a, b))
    : taggedHash('TapBranch', concat(b, a));
}

/**
 * Compute the taptree merkle root. Input is a binary tree of leaves
 * ({ script, leafVersion? }) built with h() combiners; a bare leaf is a
 * single-leaf tree whose root is its own TapLeaf hash.
 */
export type TapTree =
  | { readonly script: Uint8Array; readonly leafVersion?: number }
  | { readonly l: TapTree; readonly r: TapTree };

export function taptreeRoot(tree: TapTree): Uint8Array {
  if ('script' in tree) return tapLeafHash(tree.script, tree.leafVersion ?? LEAF_VERSION_BASE);
  return tapBranchHash(taptreeRoot(tree.l), taptreeRoot(tree.r));
}

// ── NUMS internal key (constant with provenance) ────────────────────────────

/**
 * H = G·(1/2): the community-agreed NUMS point. x-only bytes; the even-y
 * lift is applied at use time. Do not regenerate, do not "optimize".
 */
export const NUMS_INTERNAL_XONLY =
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0' as const;

let cachedNumsPoint: ReturnType<typeof liftX> | null = null;
export function numsInternalPoint() {
  if (!cachedNumsPoint) cachedNumsPoint = liftX(hexToBytes(NUMS_INTERNAL_XONLY));
  return cachedNumsPoint;
}

// ── Tweak + P2TR output ──────────────────────────────────────────────────────

/**
 * Output key from an internal x-only key and an optional merkle root:
 * Q = lift_x(P) + int(tagged_hash("TapTweak", P ‖ root))·G. Returns x-only.
 */
export function tweakOutputKey(internalXOnly: Uint8Array, merkleRoot?: Uint8Array): Uint8Array {
  if (internalXOnly.length !== 32) throw new TaprootRailError('bad_key', 'internal key must be x-only 32B');
  const preimage = merkleRoot ? concat(internalXOnly, merkleRoot) : Uint8Array.from(internalXOnly);
  const t = taggedHash('TapTweak', preimage);
  const Q = liftX(internalXOnly).add(secp256k1.Point.BASE.multiply(bytesToBigInt(t)));
  return xOnly(Q);
}

function bytesToBigInt(b: Uint8Array): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

/** P2TR scriptPubKey: OP_1 ‖ 32B key (witness v1). */
export function p2trScriptPubKey(outputXOnly: Uint8Array): Uint8Array {
  if (outputXOnly.length !== 32) throw new TaprootRailError('bad_key', 'output key must be x-only 32B');
  // P2TR scriptPubKey = OP_1 (0x51) + OP_PUSH32 (0x20) + 32B output key - the
  // 0x20 is the push-length opcode, not a key byte (BIP-341 suggested policy).
  return concat(Uint8Array.of(0x51, 0x20), outputXOnly);
}

/** Bech32m address for an output key, per HRP (BIP-350). */
export function p2trAddress(outputXOnly: Uint8Array, hrp: string): string {
  const words = [1, ...bech32m.toWords(outputXOnly)];
  return bech32m.encode(hrp, words, 90);
}

// ── Network parameters (mainnet-parity principle: swap the object) ───────────

export interface RailNetworkParams {
  readonly rail: 'btc-testnet4';
  readonly hrp: 'tb';
  readonly genesisHash: string;
  readonly minConfirmations: number;
  /** Donor refund CLTV, in blocks (owner: 72 ≈ 6h). */
  readonly refundLocktimeBlocks: number;
  /** Angor penalty days → CSV blocks for the founder-signed penalty path. */
  readonly penaltyLocktimeBlocks: number;
}

export const TESTNET4_PARAMS: RailNetworkParams = {
  rail: 'btc-testnet4',
  hrp: 'tb',
  genesisHash: BTC_TESTNET4_GENESIS_HASH,
  minConfirmations: 1, // owner call 2; mainnet parity would raise + re-review
  refundLocktimeBlocks: 72,
  penaltyLocktimeBlocks: 144, // 90d Angor default is mainnet-scale; testnet4 uses 144 ≈ 12h
};

// ── Script primitives ────────────────────────────────────────────────────────

const OP_CHECKSIG = 0xac;
const OP_CHECKSIGVERIFY = 0xad;
const OP_CHECKLOCKTIMEVERIFY = 0xb1;
const OP_CHECKSEQUENCEVERIFY = 0xb2;
const OP_HASH256 = 0xaa;
const OP_EQUAL = 0x87;
const OP_EQUALVERIFY = 0x88;
const OP_CLTV = OP_CHECKLOCKTIMEVERIFY;

function pushBytes(b: Uint8Array): Uint8Array {
  if (b.length < 0x4c) return concat(Uint8Array.of(b.length), b);
  if (b.length <= 0xff) return concat(Uint8Array.of(0x4c, b.length), b); // OP_PUSHDATA1
  if (b.length <= 0xffff) {
    return concat(Uint8Array.of(0x4d, b.length & 0xff, (b.length >> 8) & 0xff), b);
  }
  throw new TaprootRailError('bad_push', 'push too large for tapscript');
}

function op(code: number): Uint8Array {
  return Uint8Array.of(code);
}

/** 32-byte x-only pubkey push; validates shape (no 33B compressed keys here). */
function keyPush(xOnlyKey: Uint8Array): Uint8Array {
  if (xOnlyKey.length !== 32) throw new TaprootRailError('bad_key', 'tapscript keys are x-only 32B');
  return pushBytes(xOnlyKey);
}

// ── Leaf builders (full Angor-parity set) ────────────────────────────────────

/**
 * Founder stage claim (Angor founder path):
 *   <founder_key> OP_CHECKSIGVERIFY <release_block_or_time> OP_CLTV
 * CLTV semantics per BIP-65/`nLockTime` comparison rules: a value below
 * LOCKTIME_THRESHOLD (500_000_000) is a BLOCK height, at-or-above is a
 * UNIX TIME. The caller states which; a mismatch is a typed error, not a
 * silent reinterpretation.
 */
export const LOCKTIME_THRESHOLD = 500_000_000;

export function founderClaimLeaf(
  founderKeyXOnly: Uint8Array,
  release: number,
  domain: 'blocks' | 'seconds',
): { script: Uint8Array; leafVersion: number } {
  if (domain === 'blocks' && release >= LOCKTIME_THRESHOLD) {
    throw new TaprootRailError('bad_locktime', 'block-height locktime ≥ 500_000_000 (threshold)');
  }
  if (domain === 'seconds' && release < LOCKTIME_THRESHOLD) {
    throw new TaprootRailError('bad_locktime', 'unix-time locktime < 500_000_000 (threshold)');
  }
  const script = concat(keyPush(founderKeyXOnly), op(OP_CHECKSIGVERIFY), pushBytes(scriptNum(release)), op(OP_CLTV));
  return { script, leafVersion: LEAF_VERSION_BASE };
}

/**
 * Donor refund (our Angor improvement): donor self-spend after deadline.
 *   <donor_key> OP_CHECKSIGVERIFY <deadline> OP_CLTV
 */
export function donorRefundLeaf(
  donorKeyXOnly: Uint8Array,
  deadline: number,
  domain: 'blocks' | 'seconds',
): { script: Uint8Array; leafVersion: number } {
  return founderClaimLeaf(donorKeyXOnly, deadline, domain); // same shape, named for intent
}

/**
 * Founder pre-signed penalty path (Angor investor recovery):
 *   <investor_key> OP_CHECKSIGVERIFY <penalty_csv> OP_CSV
 * The FOUNDER pre-signs a transaction spending through this leaf
 * (SIGHASH_SINGLE | ANYONECANPAY per stage) and hands the signature to the
 * investor at funding time. CSV semantics: relative, block-based (BIP-112);
 * the RBF/sequence flag bits of the spending input must be ≥ the CSV value.
 */
export function penaltyCsvLeaf(
  investorKeyXOnly: Uint8Array,
  penaltyBlocks: number,
): { script: Uint8Array; leafVersion: number } {
  if (penaltyBlocks < 1 || penaltyBlocks >= LOCKTIME_THRESHOLD) {
    throw new TaprootRailError('bad_locktime', 'CSV penalty must be a positive block count');
  }
  const script = concat(keyPush(investorKeyXOnly), op(OP_CHECKSIGVERIFY), pushBytes(scriptNum(penaltyBlocks)), op(OP_CHECKSEQUENCEVERIFY));
  return { script, leafVersion: LEAF_VERSION_BASE };
}

/**
 * Regular-investor penalty recovery (Angor 2-of-2 with founder recovery key):
 *   <founder_recovery_key> OP_CHECKSIGVERIFY <investor_key> OP_CHECKSIG
 * This is the leaf the founder co-signs into the pre-signed penalty
 * transaction above; both keys together authorize the penalty spend.
 */
export function penaltyRecoveryLeaf(
  founderRecoveryKeyXOnly: Uint8Array,
  investorKeyXOnly: Uint8Array,
): { script: Uint8Array; leafVersion: number } {
  const script = concat(
    keyPush(founderRecoveryKeyXOnly),
    op(OP_CHECKSIGVERIFY),
    keyPush(investorKeyXOnly),
    op(OP_CHECKSIG),
  );
  return { script, leafVersion: LEAF_VERSION_BASE };
}

/**
 * Lead-investor secret commitment (Angor lead investor):
 *   <founder_recovery_key> OP_CHECKSIGVERIFY <investor_key> OP_CHECKSIGVERIFY
 *   OP_HASH256 <secret_hash> OP_EQUAL
 * Revealing the preimage when recovering-with-penalty enables OTHER
 * investors' penalty-free hashlock exits.
 */
export function leadInvestorHashlockLeaf(
  founderRecoveryKeyXOnly: Uint8Array,
  investorKeyXOnly: Uint8Array,
  secretHash: Uint8Array,
): { script: Uint8Array; leafVersion: number } {
  if (secretHash.length !== 32) throw new TaprootRailError('bad_hash', 'OP_HASH256 commitment must be 32B');
  const script = concat(
    keyPush(founderRecoveryKeyXOnly),
    op(OP_CHECKSIGVERIFY),
    keyPush(investorKeyXOnly),
    op(OP_CHECKSIGVERIFY),
    op(OP_HASH256),
    pushBytes(secretHash),
    op(OP_EQUAL),
  );
  return { script, leafVersion: LEAF_VERSION_BASE };
}

/**
 * Penalty-free investor exit via threshold of lead secrets (Angor §taproot
 * no-penalty path). ONE tapscript per k-combination of the n lead secret
 * hashes:
 *   OP_HASH256 <h_i1> OP_EQUALVERIFY ... OP_HASH256 <h_ik> OP_EQUALVERIFY
 *   <investor_key> OP_CHECKSIG
 * The full tree contains C(n,k) such leaves; spending reveals k secrets.
 * The builder validates the combinatorial budget BEFORE building (Angor
 * uses the same construction; huge trees are a real cost, so we fail typed
 * rather than emit a tree nobody will fund).
 */
export function hashlockThresholdLeaves(
  investorKeyXOnly: Uint8Array,
  leadSecretHashes: Uint8Array[],
  threshold: number,
  maxLeaves = 512,
): Array<{ script: Uint8Array; leafVersion: number }> {
  const n = leadSecretHashes.length;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > n) {
    throw new TaprootRailError('bad_threshold', 'threshold must be between 1 and the number of lead hashes');
  }
  if (n > 32) throw new TaprootRailError('bad_threshold', 'more than 32 lead investors unsupported');
  for (const h of leadSecretHashes) {
    if (h.length !== 32) throw new TaprootRailError('bad_hash', 'lead secret hashes must be 32B');
  }
  let count = binomial(n, threshold);
  if (count > maxLeaves) {
    throw new TaprootRailError('bad_threshold', `C(${n},${threshold}) = ${count} leaves exceeds budget ${maxLeaves}`);
  }
  const leaves: Array<{ script: Uint8Array; leafVersion: number }> = [];
  // Iterative combination walk (n ≤ 32, so index math is safe).
  const idx = Array.from({ length: threshold }, (_, i) => i);
  while (true) {
    let script: Uint8Array = new Uint8Array(0);
    for (const i of idx) {
      // Each commitment must CONSUME the hash it computes; without the
      // comparison the leaf's OP_CHECKSIG would pop the pushed constant as
      // its signature and the leaf would be unsatisfiable.
      script = concat(script, op(OP_HASH256), pushBytes(leadSecretHashes[i]), op(OP_EQUALVERIFY));
    }
    leaves.push({
      script: concat(script, keyPush(investorKeyXOnly), op(OP_CHECKSIG)),
      leafVersion: LEAF_VERSION_BASE,
    });
    count--;
    // advance to next combination
    let i = threshold - 1;
    while (i >= 0 && idx[i] === n - threshold + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < threshold; j++) idx[j] = idx[j - 1] + 1;
  }
  return leaves;
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

/**
 * End-of-project expiry (Angor): investor reclaims unused stages.
 *   <investor_key> OP_CHECKSIGVERIFY <expiry_cltv> OP_CLTV
 */
export function projectExpiryLeaf(
  investorKeyXOnly: Uint8Array,
  expiry: number,
  domain: 'blocks' | 'seconds',
): { script: Uint8Array; leafVersion: number } {
  return founderClaimLeaf(investorKeyXOnly, expiry, domain);
}

// ── Contribution output assembly ─────────────────────────────────────────────

export interface ContributionOutputKeys {
  /** Donor's taproot x-only key (from their wallet at pledge time). */
  readonly donorKeyXOnly: Uint8Array;
  /** Founder's x-only claim key (registered with the campaign). */
  readonly founderKeyXOnly: Uint8Array;
  /** Founder's x-only recovery key (Angor 2-of-2 partner). */
  readonly founderRecoveryKeyXOnly: Uint8Array;
  /** Investor key for penalty/recovery paths (donor-side, distinct wallet). */
  readonly investorKeyXOnly: Uint8Array;
  /** Lead-investor secret hashes for the penalty-free tree (optional). */
  readonly leadSecretHashes?: readonly Uint8Array[];
  readonly leadThreshold?: number;
}

export interface ContributionTimes {
  /** Founder stage release (CLTV). */
  readonly release: number;
  readonly releaseDomain: 'blocks' | 'seconds';
  /** Donor refund deadline (CLTV). */
  readonly refundDeadline: number;
  readonly refundDomain: 'blocks' | 'seconds';
  /** Penalty CSV blocks. */
  readonly penaltyBlocks: number;
  /** Project expiry (CLTV). */
  readonly expiry: number;
  readonly expiryDomain: 'blocks' | 'seconds';
}

export interface BuiltContribution {
  readonly merkleRoot: Uint8Array;
  readonly outputXOnly: Uint8Array;
  readonly scriptPubKey: Uint8Array;
  readonly address: string;
  readonly leaves: ReadonlyArray<{ readonly name: string; readonly script: Uint8Array; readonly leafVersion: number }>;
}

/**
 * Assemble a full contribution output: the complete Angor-parity taptree
 * (founder stage ‖ donor refund ‖ penalty 2-of-2 ‖ penalty CSV ‖ optional
 * hashlock-threshold branches ‖ expiry) under the NUMS internal key, and
 * the resulting P2TR address. Pure: same inputs → same bytes.
 */
export function buildContributionOutput(
  keys: ContributionOutputKeys,
  times: ContributionTimes,
  params: RailNetworkParams = TESTNET4_PARAMS,
): BuiltContribution {
  const founder = founderClaimLeaf(keys.founderKeyXOnly, times.release, times.releaseDomain);
  const refund = donorRefundLeaf(keys.donorKeyXOnly, times.refundDeadline, times.refundDomain);
  const penalty2of2 = penaltyRecoveryLeaf(keys.founderRecoveryKeyXOnly, keys.investorKeyXOnly);
  const penaltyCsv = penaltyCsvLeaf(keys.investorKeyXOnly, times.penaltyBlocks);
  const expiry = projectExpiryLeaf(keys.investorKeyXOnly, times.expiry, times.expiryDomain);

  const named: Array<{ name: string; script: Uint8Array; leafVersion: number }> = [
    { name: 'founder_claim', ...founder },
    { name: 'donor_refund', ...refund },
    { name: 'penalty_recovery_2of2', ...penalty2of2 },
    { name: 'penalty_csv', ...penaltyCsv },
    { name: 'project_expiry', ...expiry },
  ];

  // Lead-investor penalty-free tree: each combination becomes a branch child.
  let tree: TapTree;
  if (keys.leadSecretHashes?.length && keys.leadThreshold) {
    const hashlockLeaves = hashlockThresholdLeaves(
      keys.investorKeyXOnly,
      [...keys.leadSecretHashes],
      keys.leadThreshold,
    );
    hashlockLeaves.forEach((leaf, i) => named.push({ name: `hashlock_threshold_${i}`, ...leaf }));
    tree = namedToTree(named);
  } else {
    tree = namedToTree(named);
  }

  const root = taptreeRoot(tree);
  const output = tweakOutputKey(hexToBytes(NUMS_INTERNAL_XONLY), root);
  return {
    merkleRoot: root,
    outputXOnly: output,
    scriptPubKey: p2trScriptPubKey(output),
    address: p2trAddress(output, params.hrp),
    leaves: named,
  };
}

function namedToTree(named: Array<{ name: string; script: Uint8Array; leafVersion: number }>): TapTree {
  if (named.length === 0) throw new TaprootRailError('bad_tree', 'empty taptree');
  if (named.length === 1) return { script: named[0].script, leafVersion: named[0].leafVersion };
  // Deterministic balanced fold (sorted by script bytes for byte-stability).
  let level: TapTree[] = named
    .slice()
    .sort((a, b) => bytesToHex(a.script) < bytesToHex(b.script) ? -1 : 1)
    .map((l) => ({ script: l.script, leafVersion: l.leafVersion }) as TapTree);
  while (level.length > 1) {
    const next: TapTree[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(level[i + 1] ? { l: level[i], r: level[i + 1] } : level[i]);
    }
    level = next;
  }
  return level[0];
}
