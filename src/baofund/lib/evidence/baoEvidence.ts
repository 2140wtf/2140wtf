/**
 * baoEvidence - Bao (BLAKE3 verified streaming) for pledge evidence artifacts.
 *
 * A milestone's evidence (archives, screenshots, logs, build outputs) is a
 * large artifact the community must be able to verify WITHOUT trusting the
 * host that serves it. Serial hashing forces a full re-download to verify
 * anything; Bao encodes the artifact together with its BLAKE3 hash tree so
 * ANY 4 KiB slice can be verified against the 32-byte root hash - the same
 * hash that goes into the milestone attestation event.
 *
 * Flow (pledge evidence):
 *   1. Founder encodes the artifact → root hash + encoded blob.
 *   2. Root hash rides in the milestone evidence (contract_hash / artifact
 *      event tags) - it is already the SHA-256-shaped commitment the work
 *      contract expects, but now it is SEEKABLE.
 *   3. Attestors fetch random slices from the host (or several hosts) and
 *      verify each against the root - spot-checking GBs of evidence with KBs
 *      of transfer.
 *
 * The encoding is a pure function of the bytes: no keys, no secrets. The
 * verification strength comes from the root hash's publication path (the
 * Nostr event), not from this module.
 */
import {
  baoEncode,
  baoDecode,
  baoSlice,
  baoDecodeSlice,
  toHex,
} from 'blake3-bao';

/** Bao slice granularity used by this module (matches blake3-bao's default
 *  chunk group size; Carbonado v2 standardized the same 4 KiB geometry). */
export const BAO_SLICE_LEN = 4096;

export interface BaoEncoded {
  /** 32-byte BLAKE3 root hash - the published commitment. */
  rootHash: Uint8Array;
  /** Root hash as lowercase hex (64 chars) for Nostr tags / JSON. */
  rootHashHex: string;
  /** The combined encoding: content bytes + hash tree. */
  encoded: Uint8Array;
  /** Original content length in bytes. */
  contentLength: number;
}

/** Encode an artifact into its Bao form. */
export function encodeEvidence(content: Uint8Array): BaoEncoded {
  const { encoded, hash } = baoEncode(content);
  return {
    rootHash: hash,
    rootHashHex: toHex(hash),
    encoded,
    contentLength: content.length,
  };
}

/** Decode + fully verify an encoded artifact against its published root.
 *  Throws on any corrupted byte (BLAKE3 tree mismatch). */
export function decodeEvidence(encoded: Uint8Array, rootHash: Uint8Array): Uint8Array {
  return baoDecode(encoded, rootHash);
}

/** Extract a verifiable slice [start, start+len) from an encoded artifact.
 *  The returned bytes carry their own tree proof - no trust in the server. */
export function sliceEvidence(encoded: Uint8Array, start: number, len: number): Uint8Array {
  return baoSlice(encoded, start, len);
}

/** Verify a slice against the published root. Returns the decoded bytes.
 *  Throws on mismatch. */
export function verifySlice(
  rootHash: Uint8Array,
  start: number,
  len: number,
  slice: Uint8Array,
): Uint8Array {
  return baoDecodeSlice(slice, rootHash, start, len);
}

/** Spot-check plan: evenly spaced (start, len) slice requests covering an
 *  artifact of `contentLength` bytes with `count` random-ish probes. Used by
 *  attestors to pick WHICH slices to fetch; deterministic so multiple
 *  attestors converge on the same slices without coordination. */
export function spotCheckPlan(contentLength: number, count: number): Array<{ start: number; len: number }> {
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) return [];
  if (!Number.isSafeInteger(count) || count <= 0) return [];
  const len = Math.min(BAO_SLICE_LEN, contentLength);
  if (contentLength <= len) return [{ start: 0, len }];
  const plan: Array<{ start: number; len: number }> = [];
  const stride = Math.floor((contentLength - len) / count);
  for (let i = 0; i < count; i++) {
    plan.push({ start: i * stride, len });
  }
  return plan;
}

/** Convenience: hex root for tags. */
export function rootHex(e: BaoEncoded): string {
  return e.rootHashHex;
}
