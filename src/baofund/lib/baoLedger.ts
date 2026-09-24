/**
 * Bao escrow deterministic hashing helpers - used by the §5.6 ledger stub.
 * The §1.5 wire contract remains under review (R03): this legacy sorted-key
 * encoding is NOT a claim of schema-order/prefixed-hash conformance.
 *
 * Existing helper encoding (valid-input bytes preserved by validation fixes):
 * - Canonical JSON: keys sorted recursively, lexicographically by UTF-8
 *   bytes; strings NFC-normalized; integers only (floats are a schema
 *   violation); `null` means unset, never `0`; no insignificant whitespace.
 * - `intentHash`  = blake3(canonical bytes of the whole object).
 * - `prevHash`    = blake3(canonical bytes of {seq, created_at, event_id,
 *   content}) - nonce-field elision does NOT apply here (§5.6 amend 4).
 * - `proofSetHash` = blake3(canonical array sorted by per-element blake3).
 * - Genesis `prevHash` = blake3 of the campaign a-coordinate string.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** blake3 over the canonical JSON encoding of `value`, hex-encoded. */
export function canonicalHash(value: unknown): string {
  return bytesToHex(blake3(canonicalBytes(value)));
}

function canonicalBytes(value: unknown): Uint8Array {
  return utf8ToBytes(canonicalJson(value));
}

/**
 * Deterministic JSON for plain JSON data with safe integer numbers and
 * well-formed Unicode. Rejects values JSON cannot faithfully carry rather
 * than silently dropping fields, invoking getters or emitting duplicate keys.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set());
}

function normalizedString(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('canonicalJson: unpaired surrogate');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError('canonicalJson: unpaired surrogate');
  }
  return value.normalize('NFC');
}

function encode(value: unknown, active: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(normalizedString(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    if (!Number.isInteger(value)) throw new TypeError('canonicalJson: float not allowed');
    if (!Number.isSafeInteger(value)) throw new TypeError('canonicalJson: unsafe integer');
    return String(value); // -0 normalizes to 0; safe integers never use exponents.
  }
  if (typeof value !== 'object') throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  if (active.has(value)) throw new TypeError('canonicalJson: cyclic input');
  active.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError('canonicalJson: symbol keys unsupported');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      // A hole is not null. map() would skip it and emit invalid/ambiguous JSON.
      if (Object.keys(descriptors).length !== value.length + 1) throw new TypeError('canonicalJson: sparse array or extra array fields');
      const elements: string[] = [];
      for (let i = 0; i < value.length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new TypeError('canonicalJson: sparse array or accessor');
        elements.push(encode(descriptor.value, active));
      }
      return '[' + elements.join(',') + ']';
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('canonicalJson: plain objects required');
    const normalized = new Map<string, unknown>();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor) || !descriptor.enumerable) throw new TypeError('canonicalJson: accessors or hidden fields unsupported');
      const name = normalizedString(key);
      if (normalized.has(name)) throw new TypeError('canonicalJson: duplicate normalized key');
      normalized.set(name, descriptor.value);
    }
    return '{' + [...normalized.keys()].sort(utf8Compare)
      .map(key => `${JSON.stringify(key)}:${encode(normalized.get(key), active)}`).join(',') + '}';
  } finally {
    active.delete(value);
  }
}

/** Lexicographic comparison over UTF-8 bytes (not code points). */
export function utf8Compare(a: string, b: string): number {
  const ab = utf8ToBytes(normalizedString(a));
  const bb = utf8ToBytes(normalizedString(b));
  const len = Math.min(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    if (ab[i] !== bb[i]) return ab[i] < bb[i] ? -1 : 1;
  }
  return ab.length - bb.length;
}

/**
 * §5.6 amend 4: prevHash = blake3 over canonical bytes of exactly this
 * envelope - all four fields participate (no elision).
 */
export function ledgerEntryPrevHash(entry: {
  seq: number;
  created_at: number;
  event_id: string;
  content: unknown;
}): string {
  return canonicalHash({
    seq: entry.seq,
    created_at: entry.created_at,
    event_id: entry.event_id,
    content: entry.content,
  });
}

/** Genesis prevHash: blake3 of the campaign a-coordinate string. */
export function genesisPrevHash(aCoordinate: string): string {
  return bytesToHex(blake3(utf8ToBytes(normalizedString(aCoordinate))));
}

/** One Cashu proof descriptor inside a ProofMeta array (spec §5.5). */
export interface ProofMeta {
  /** Hash of the proof's secret (never the secret itself - design doc §7). */
  secretCommit: string;
  mint: string;
  /** Capital-cost tier qualifier (age-locked, two-mint, …) - null pre-scheme-B. */
  tier: string | null;
  /** Pinned at create; mint-enforced locktime for refund-only proofs. */
  deadlineMs: number | null;
}

/** proofSetHash: sort by per-element blake3, hash the canonical array. */
export function proofSetHash(proofs: ProofMeta[]): string {
  const sorted = [...proofs].sort((a, b) => canonicalHash(a).localeCompare(canonicalHash(b)));
  return canonicalHash(sorted);
}

/** Full a-coordinate for a campaign (never a bare slug - §5.6). */
export function campaignACoord(creatorPubkey: string, slug: string): string {
  return `39801:${creatorPubkey}:${slug}`;
}
