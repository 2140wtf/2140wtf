// src/lib/evidence/encryptedEvidence.ts
//
// Carbonado-style at-rest encryption for PRIVATE milestone evidence artifacts.
//
// Port of the discipline from bitmask-stack/carbonado (src/crypto.rs, v2):
//   - AES-256-CTR for length-preserving bulk encryption (WebCrypto CTR is
//     Ctr128BE - same counter semantics Carbonado uses via `Ctr128BE<Aes256>`),
//   - HMAC-SHA512 with the FULL 64-byte tag in Encrypt-then-MAC construction,
//   - labeled subkey derivation for key separation (via our keySchedule,
//     `baofund-kdf/v1/` namespace - never Carbonado's),
//   - explicit verify-before-decrypt with constant-time tag comparison,
//   - MAC input is `domain || nonce || ct` (Carbonado: prefix || nonce || ct).
//
// Wire format (Carbonado's internal-nonce layout):
//   [nonce(16) | tag(64) | ciphertext]  - overhead: 80 bytes.
// The nonce is not secret; it is stored in the clear (standard CTR model).
// Uniqueness per (master, operation) is guaranteed by CSPRNG generation and
// asserted in tests.
//
// Composition with the verified-streaming layer (baoEvidence.ts): encrypt
// FIRST, then Bao-encode the ciphertext. Storage/relays then hold only
// ciphertext whose integrity is verifiable by anyone (Bao is keyless);
// confidentiality lives solely in the artifact master key. The published
// root hash commits to the ciphertext, so attestors can still spot-check
// slices without any key.
//
// Key schedule (all labels registered in KDF_LABELS):
//   artifactMaster = deriveSubkey32(identity, 'evidence-encryption')  // per artifact
//   aesKey(32)     = deriveSubkey(artifactMaster, 'evidence-enc-ctr')[..32]
//   etmKey(64)     = deriveSubkey(artifactMaster, 'evidence-enc-etm')
//
// Threat-model note (mirrors Carbonado): this is at-rest confidentiality for
// stored artifacts. It does not authenticate WHO uploaded; authorship still
// comes from the Nostr signatures around the evidence tag.

import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { deriveSubkey, deriveSubkey32, KDF_LABELS } from '../../wallet/keySchedule';
import { EVIDENCE_ENCODING, type BaoEvidenceFields, type EncodedMilestoneEvidence } from './attestationEvidence';
import {
  encodeEvidence,
  decodeEvidence,
  sliceEvidence,
  verifySlice,
  spotCheckPlan,
  BAO_SLICE_LEN,
  rootHex,
} from './baoEvidence';
import type { BaoEncoded } from './baoEvidence';

/** MAC domain prefix - mirrors Carbonado's b"carbonado-v2-etm". */
const ETM_DOMAIN = 'baofund-etm/v1';

const NONCE_LEN = 16;
const TAG_LEN = 64;
const OVERHEAD = NONCE_LEN + TAG_LEN;

const te = new TextEncoder();

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('encryptedEvidence: WebCrypto subtle unavailable in this runtime');
  return c.subtle;
};

/** Constant-time equality (Carbonado's ct_eq). */
function ctEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i]! ^ b[i]!;
  return r === 0;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Resolve the AES-256 key + 64-byte EtM key from an artifact master
 * (Carbonado separation step). `context` domain-separates the derivation
 * per artifact (e.g. the plaintext's content hash) so two artifacts never
 * share cipher keys even under the same identity master.
 */
function resolveSubkeys(master: Uint8Array, context?: Uint8Array): { aesKey: Uint8Array; etmKey: Uint8Array } {
  if (master.length < 32) throw new Error(`encryptedEvidence: master must be >= 32 bytes (got ${master.length})`);
  const aesKey = deriveSubkey(master, KDF_LABELS.evidenceEncCtr, context).slice(0, 32);
  const etmKey = deriveSubkey(master, KDF_LABELS.evidenceEncEtm, context);
  return { aesKey, etmKey };
}

/** Full-width HMAC-SHA512 over `domain || parts...` (sync, @noble). */
function etmTag(etmKey: Uint8Array, parts: Uint8Array[]): Uint8Array {
  return hmac(sha512, etmKey, concat(te.encode(ETM_DOMAIN), ...parts));
}

/**
 * Encrypt an artifact (Carbonado `symmetric_encrypt`):
 * returns `[nonce(16) | tag(64) | ct]`. The subkeys are context-separated
 * by the PLAINTEXT LENGTH (recoverable from the blob on decrypt - the
 * plaintext hash is NOT, so it cannot be the context), which gives every
 * distinct artifact an independent AES/MAC key under the same master.
 */
export async function encryptEvidenceArtifact(master: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const context = new Uint8Array(4);
  new DataView(context.buffer).setUint32(0, plaintext.length, false); // big-endian
  const { aesKey, etmKey } = resolveSubkeys(master, context);
  const nonce = new Uint8Array(NONCE_LEN);
  globalThis.crypto.getRandomValues(nonce);

  const key = await subtle().importKey('raw', aesKey as BufferSource, { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: 'AES-CTR', counter: nonce as BufferSource, length: 128 }, key, plaintext as BufferSource),
  );

  const tag = etmTag(etmKey, [nonce, ct]);
  return concat(nonce, tag, ct);
}

/**
 * Verify + decrypt an artifact (Carbonado `symmetric_decrypt`).
 * Throws on ANY tampering (tag, nonce, or ciphertext) - verification happens
 * before any decryption, and comparison is constant-time.
 */
export async function decryptEvidenceArtifact(master: Uint8Array, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.length < OVERHEAD) {
    throw new Error(`encryptedEvidence: blob too short (${blob.length} bytes, need >= ${OVERHEAD})`);
  }
  // Context = plaintext length (recoverable: blob length minus overhead) -
  // must match the encrypt side exactly for the MAC/subkey derivation.
  const context = new Uint8Array(4);
  new DataView(context.buffer).setUint32(0, blob.length - OVERHEAD, false); // plaintext length
  const { aesKey, etmKey } = resolveSubkeys(master, context);
  const nonce = blob.slice(0, NONCE_LEN);
  const tag = blob.slice(NONCE_LEN, NONCE_LEN + TAG_LEN);
  const ct = blob.slice(NONCE_LEN + TAG_LEN);

  const expected = etmTag(etmKey, [nonce, ct]);
  if (!ctEq(expected, tag)) throw new Error('encryptedEvidence: authentication failed');

  const key = await subtle().importKey('raw', aesKey as BufferSource, { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
  const pt = await subtle().decrypt({ name: 'AES-CTR', counter: nonce as BufferSource, length: 128 }, key, ct as BufferSource);
  return new Uint8Array(pt);
}

export interface EncryptedEvidenceArtifact {
  /** The encrypted blob: [nonce | tag | ct]. */
  blob: Uint8Array;
  /** Bao encoding of the ENCRYPTED blob - this is what gets uploaded/stored. */
  encoded: Uint8Array;
  /** BLAKE3/Bao root over the ENCRYPTED blob - publishable in evidence tags. */
  rootHash: Uint8Array;
  rootHashHex: string;
  contentLength: number;
}

/**
 * Full at-rest pipeline (encrypt → Bao): produces the storable, verifiable,
 * confidential artifact. `rootHashHex` is what goes into the Nostr evidence
 * tag; `encoded` is what gets uploaded.
 */
export async function encodePrivateEvidence(master: Uint8Array, plaintext: Uint8Array): Promise<EncryptedEvidenceArtifact> {
  const blob = await encryptEvidenceArtifact(master, plaintext);
  const enc: BaoEncoded = encodeEvidence(blob);
  return { blob, encoded: enc.encoded, rootHash: enc.rootHash, rootHashHex: enc.rootHashHex, contentLength: blob.length };
}

/**
 * Inverse of `encodePrivateEvidence` - full Bao verification, then decryption.
 * Throws if the Bao encoding fails verification OR the EtM tag fails.
 */
export async function decodePrivateEvidence(
  master: Uint8Array,
  encoded: Uint8Array,
  rootHash: Uint8Array,
): Promise<Uint8Array> {
  const blob = decodeEvidence(encoded, rootHash);
  return decryptEvidenceArtifact(master, blob);
}

/**
 * Attestor path WITHOUT the key: extract one spot-check slice of the
 * *encrypted* artifact and verify it against the published root. Throws on
 * any mismatch; verification is purely structural (Bao proof).
 */
export function verifyPrivateSlice(
  encoded: Uint8Array,
  rootHash: Uint8Array,
  start: number,
  len: number,
): { slice: Uint8Array; verified: true } {
  const slice = sliceEvidence(encoded, start, len);
  verifySlice(rootHash, start, len, slice);
  return { slice, verified: true };
}

/**
 * Derive the per-artifact master from an identity privkey. Producer and
 * consumer MUST use this: passing the raw identity key encrypts under a
 * different master than every documented/tested decryptor derives, making
 * the artifact unrecoverable.
 */
export function deriveEvidenceMaster(identityPrivkey: Uint8Array): Uint8Array {
  return deriveSubkey32(identityPrivkey, KDF_LABELS.evidenceEncryption);
}

/**
 * Private-mode milestone evidence: same published shape as
 * `encodeMilestoneEvidence` (attestationEvidence), but the hosted artifact is
 * the ENCRYPTED blob's Bao encoding. The published root commits to ciphertext
 * - attestors spot-check structure WITHOUT any key; only holders of the
 * identity master can decrypt (`decodePrivateEvidence`).
 */
export async function encodePrivateMilestoneEvidence(
  master: Uint8Array,
  plaintext: Uint8Array,
): Promise<EncodedMilestoneEvidence> {
  const art = await encodePrivateEvidence(master, plaintext);
  const fields: BaoEvidenceFields = {
    evidence_encoding: EVIDENCE_ENCODING,
    evidence_root_hash: art.rootHashHex,
    evidence_bytes: art.contentLength,
  };
  return {
    encoded: art.encoded,
    contentLength: art.contentLength,
    rootHashHex: art.rootHashHex,
    archiveSha256Hex: bytesToHex(sha256(art.encoded)),
    fields,
  };
}

// Re-exports so attestor code can work entirely from this module.
export { spotCheckPlan, BAO_SLICE_LEN, verifySlice, sliceEvidence, rootHex };
export type { BaoEncoded };
