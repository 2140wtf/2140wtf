/**
 * attestationEvidence - Bao verified streaming wired into the milestone
 * attestation flow.
 *
 * Owner (proof side):
 *   1. `encodeMilestoneEvidence(bytes)` encodes the artifact with Bao
 *      (BLAKE3 hash tree + content) and derives the optional
 *      MilestoneEvidenceV1 fields (`evidence_encoding`, `evidence_root_hash`,
 *      `evidence_bytes`) plus the sha256 of the file to host.
 *   2. The Bao ENCODING (not the raw artifact) is uploaded to the archive
 *      URL and pinned by `archive.sha256`.
 *   3. `buildEvidenceTag(fields)` rides on the kind-37107 proof-of-work
 *      event as an `evidence` tag - the published commitment attestors
 *      verify against. The fields also ride inside the scored
 *      MilestoneEvidenceV1 payload so the AI judge sees the same root.
 *
 * Attestor (verification side):
 *   `verifyMilestoneEvidenceArtifact` spot-checks the hosted artifact
 *   against the published commitments:
 *   - `archive.sha256` pins the exact encoding file. It is validated up
 *     front (missing/empty/malformed fails closed) and checked against the
 *     fetched bytes; the slice endpoint cannot recompute a whole-file hash,
 *     so by default the archive is still fetched once for this check.
 *     `verifyArchiveHash: false` explicitly opts into root-only slice
 *     verification (KBs of transfer) and reports `archiveHashVerified:
 *     false` - the gap is never silent;
 *   - slice endpoint: GET `<sliceUrl with {start}/{len} tokens>` returns a
 *     raw Bao slice (host-side `baoSlice(encoding, start, len)`) - each
 *     slice carries its own tree proof, so the host cannot lie;
 *   - fallback: a plain full GET of the encoding, fully tree-verified.
 *   A hostile host fails verification with an error either way; nothing in
 *   this module trusts the transport.
 *
 * The slice endpoint is a one-line wrapper over `baoSlice` for any host
 * that stores the encoding (a static bucket + tiny handler, or the bao-api
 * later). Without one, the full-fetch fallback still works everywhere.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { BAO_SLICE_LEN, decodeEvidence, encodeEvidence, spotCheckPlan, verifySlice, type BaoEncoded } from './baoEvidence';

/** Encoding identifier carried in MilestoneEvidenceV1 + the evidence tag. */
export const EVIDENCE_ENCODING = 'bao/blake3-v1';

/** Nostr tag name on the kind-37107 proof-of-work event. */
export const EVIDENCE_TAG = 'evidence';

/** Defense-in-depth cap on a slice-endpoint response (4 KiB chunk + tree proof path). */
const MAX_SLICE_RESPONSE_BYTES = 256 * 1024;

/** Default cap for the full-fetch fallback (combined encoding size). */
const DEFAULT_MAX_FULL_BYTES = 64 * 1024 * 1024;

const HEX_32 = /^[0-9a-f]{64}$/;

export type EvidenceArchiveHashErrorCode = 'archive_hash_missing' | 'archive_hash_malformed' | 'archive_hash_mismatch';

/** Typed failure for the `MilestoneEvidenceV1.archive.sha256` commitment.
 *  `archive.sha256` pins the exact Bao encoding hosted at the archive URL;
 *  the verifier must never report success without checking it. */
export class EvidenceArchiveHashError extends Error {
  readonly code: EvidenceArchiveHashErrorCode;
  constructor(code: EvidenceArchiveHashErrorCode, message: string) {
    super(message);
    this.name = 'EvidenceArchiveHashError';
    this.code = code;
  }
}

/** Fail-closed validation of the published archive hash. `archive.sha256`
 *  is REQUIRED by the MilestoneEvidenceV1 type contract, so a missing or
 *  malformed value is a verification error, never a skipped check. */
function assertArchiveSha256(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EvidenceArchiveHashError(
      'archive_hash_missing',
      'Evidence archive sha256 is required (MilestoneEvidenceV1.archive.sha256).',
    );
  }
  if (!HEX_32.test(value)) {
    throw new EvidenceArchiveHashError(
      'archive_hash_malformed',
      'Evidence archive sha256 must be lowercase 32-byte hex.',
    );
  }
  return value;
}

/**
 * The Bao slice header (first 8 bytes, little-endian) is the artifact's
 * total content length, authenticated by the Merkle proof it frames: the
 * tree traversal uses it, so a forged value cannot verify. Returns null when
 * the header is missing or not a safe integer.
 */
function sliceContentLength(slice: Uint8Array): number | null {
  if (slice.length < 8) return null;
  try {
    const header = new DataView(slice.buffer, slice.byteOffset, 8).getBigUint64(0, true);
    return header <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(header) : null;
  } catch {
    return null;
  }
}

/** The optional MilestoneEvidenceV1 fields contributed by this module. */
export interface BaoEvidenceFields {
  evidence_encoding: string;
  evidence_root_hash: string;
  evidence_bytes: number;
}

export interface EncodedMilestoneEvidence {
  /** Full Bao encoding (tree + content) - the file to upload to the archive URL. */
  encoded: Uint8Array;
  /** Original artifact length in bytes. */
  contentLength: number;
  /** Bao root hash commitment (lowercase hex) - published in tags/payload. */
  rootHashHex: string;
  /** sha256 of the ENCODING bytes - pins the exact file at the archive URL. */
  archiveSha256Hex: string;
  /** Ready-to-spread optional MilestoneEvidenceV1 fields. */
  fields: BaoEvidenceFields;
}

/** Encode a milestone evidence artifact and derive every published field. */
export function encodeMilestoneEvidence(content: Uint8Array): EncodedMilestoneEvidence {
  if (!Number.isSafeInteger(content.length) || content.length <= 0) {
    throw new Error('Evidence artifact is empty.');
  }
  const enc: BaoEncoded = encodeEvidence(content);
  return {
    encoded: enc.encoded,
    contentLength: enc.contentLength,
    rootHashHex: enc.rootHashHex,
    archiveSha256Hex: bytesToHex(sha256(enc.encoded)),
    fields: {
      evidence_encoding: EVIDENCE_ENCODING,
      evidence_root_hash: enc.rootHashHex,
      evidence_bytes: enc.contentLength,
    },
  };
}

/** Build the `evidence` tag for the kind-37107 proof-of-work event. */
export function buildEvidenceTag(fields: BaoEvidenceFields): string[] {
  assertFields(fields);
  return [EVIDENCE_TAG, fields.evidence_root_hash, fields.evidence_encoding, String(fields.evidence_bytes)];
}

/**
 * Parse + strictly validate an `evidence` tag. Returns null when the event
 * carries no evidence tag; throws on a MALFORMED one (a broken commitment
 * must never silently pass as "no evidence").
 */
export function parseEvidenceTag(tags: readonly (readonly string[])[]): BaoEvidenceFields | null {
  const tag = tags.find((t) => t[0] === EVIDENCE_TAG);
  if (!tag) return null;
  if (tag.length !== 4) throw new Error(`Malformed ${EVIDENCE_TAG} tag: expected 4 elements.`);
  const fields: BaoEvidenceFields = {
    evidence_root_hash: tag[1],
    evidence_encoding: tag[2],
    evidence_bytes: Number(tag[3]),
  };
  assertFields(fields);
  return fields;
}

/** Fail-closed validation of the Bao evidence fields (shared by tag + payload paths). */
export function assertFields(fields: BaoEvidenceFields): void {
  if (fields.evidence_encoding !== EVIDENCE_ENCODING) {
    throw new Error(`Unsupported evidence_encoding "${fields.evidence_encoding}" - expected "${EVIDENCE_ENCODING}".`);
  }
  if (!HEX_32.test(fields.evidence_root_hash)) {
    throw new Error('evidence_root_hash must be lowercase 32-byte hex.');
  }
  if (!Number.isSafeInteger(fields.evidence_bytes) || fields.evidence_bytes <= 0) {
    throw new Error('evidence_bytes must be a positive integer.');
  }
}

export interface VerifyEvidenceOptions {
  /** HTTPS URL hosting the Bao ENCODING (pinned by archive.sha256). */
  archiveUrl: string;
  /** Published sha256 of the exact encoding hosted at archiveUrl
   *  (MilestoneEvidenceV1.archive.sha256). REQUIRED - validated up front
   *  and checked against the served encoding bytes. */
  archiveSha256Hex: string;
  /** Published root-hash commitment (from the evidence tag / payload). */
  rootHashHex: string;
  /** Published original content length (evidence_bytes). */
  contentLength: number;
  /** Slice endpoint template containing `{start}` and `{len}` tokens. */
  sliceUrl?: string;
  /** Slice strategy only (default true). The archive sha256 pins the WHOLE
   *  encoding and cannot be recomputed from slice responses, so the default
   *  verifier still fetches the archive once and checks the commitment
   *  before the probes. Set false to explicitly accept root-only slice
   *  verification (KBs of transfer); the result then reports
   *  `archiveHashVerified: false` and the caller owns that residual gap. */
  verifyArchiveHash?: boolean;
  /** Spot-check probe count (default 8, deterministic via spotCheckPlan). */
  probes?: number;
  /** Full-fetch fallback cap in bytes (default 64 MiB). */
  maxFullBytes?: number;
  /** Test seam - defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface VerifyEvidenceResult {
  verified: true;
  /** 'slice' = slice endpoint probes; 'full' = whole-encoding tree verify. */
  strategy: 'slice' | 'full';
  slicesChecked: number;
  contentLength: number;
  rootHashHex: string;
  /** The archive commitment this result was checked against. */
  archiveSha256Hex: string;
  /** True when the fetched encoding bytes were hashed and matched the
   *  published archive sha256; false only for an explicit root-only slice
   *  verification (`verifyArchiveHash: false`). */
  archiveHashVerified: boolean;
}

/**
 * Spot-check a hosted artifact against the published Bao root hash.
 * Throws on ANY verification failure - the caller treats an error as
 * "evidence did not verify", never as partial credit.
 */
export async function verifyMilestoneEvidenceArtifact(opts: VerifyEvidenceOptions): Promise<VerifyEvidenceResult> {
  const { archiveUrl, rootHashHex, contentLength } = opts;
  const archiveSha256Hex = assertArchiveSha256(opts.archiveSha256Hex);
  assertFields({
    evidence_encoding: EVIDENCE_ENCODING,
    evidence_root_hash: rootHashHex,
    evidence_bytes: contentLength,
  });
  let archive: URL;
  try {
    archive = new URL(archiveUrl);
  } catch {
    throw new Error('Evidence archive URL is invalid.');
  }
  if (archive.protocol !== 'https:') throw new Error('Evidence archive URL must use HTTPS.');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const root = hexToBytes(rootHashHex);

  // The archive sha256 pins the exact encoding bytes. It can only be
  // recomputed from the FULL file, so every path that claims it must fetch
  // the archive (the slice endpoint serves subtrees, never the whole file).
  const maxFullBytes = opts.maxFullBytes ?? DEFAULT_MAX_FULL_BYTES;
  const fetchVerifiedArchiveEncoding = async (): Promise<Uint8Array> => {
    const res = await fetchImpl(archiveUrl);
    if (!res.ok) throw new Error(`Evidence archive request failed with HTTP ${res.status}.`);
    const declaredFull = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredFull) && declaredFull > maxFullBytes) {
      await res.body?.cancel();
      throw new Error(
        `Evidence encoding declares ${declaredFull} bytes - exceeds the ${maxFullBytes} byte full-verification cap. Host a slice endpoint instead.`,
      );
    }
    const encoded = await readCapped(res, maxFullBytes);
    const actual = bytesToHex(sha256(encoded));
    if (actual !== archiveSha256Hex) {
      throw new EvidenceArchiveHashError(
        'archive_hash_mismatch',
        `Evidence archive sha256 does not match the published archive.sha256 (served ${actual}).`,
      );
    }
    return encoded;
  };

  // Slice-endpoint strategy: deterministic probes, each verified in isolation.
  if (opts.sliceUrl) {
    const verifyArchiveHash = opts.verifyArchiveHash !== false;
    // Default fail-closed: check the archive commitment first so a lying
    // published hash fails before any slice transfer. An explicit
    // `verifyArchiveHash: false` opts into root-only verification.
    if (verifyArchiveHash) await fetchVerifiedArchiveEncoding();
    const plan = spotCheckPlan(contentLength, opts.probes ?? 8);
    if (plan.length === 0) throw new Error('Spot-check plan is empty.');
    for (const { start, len } of plan) {
      const url = opts.sliceUrl.replace('{start}', String(start)).replace('{len}', String(len));
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`Evidence slice request failed with HTTP ${res.status}.`);
      // Enforce the size cap BEFORE buffering: a hostile host streaming
      // gigabytes must be cut off mid-flight, not after arrayBuffer() has
      // already consumed the memory.
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_SLICE_RESPONSE_BYTES) {
        await res.body?.cancel();
        throw new Error('Evidence slice response exceeded its size cap (content-length).');
      }
      const slice = await readCapped(res, MAX_SLICE_RESPONSE_BYTES);
      // The slice header commits to the artifact's TOTAL length. Without this
      // check an inflated evidence_bytes "verifies" (out-of-range probes clamp
      // to an empty slice) and an understated one is undetectable - the full
      // fetch path has always enforced the same equality.
      const sliceLen = sliceContentLength(slice);
      if (sliceLen !== contentLength) {
        throw new Error(
          `Evidence slice does not commit to the published evidence_bytes (header ${sliceLen ?? 'unreadable'}, published ${contentLength}).`,
        );
      }
      // Throws on tree mismatch - a lying host fails here.
      const decoded = verifySlice(root, start, len, slice);
      if (decoded.length !== len) {
        throw new Error(`Evidence slice decoded ${decoded.length} bytes, expected ${len}.`);
      }
    }
    return {
      verified: true,
      strategy: 'slice',
      slicesChecked: plan.length,
      contentLength,
      rootHashHex,
      archiveSha256Hex,
      archiveHashVerified: verifyArchiveHash,
    };
  }

  // Full-fallback strategy: one GET, archive-hash + whole-tree verification.
  const encoded = await fetchVerifiedArchiveEncoding();
  const decoded = decodeEvidence(encoded, root);
  if (decoded.length !== contentLength) {
    throw new Error(`Decoded evidence length ${decoded.length} does not match the published evidence_bytes ${contentLength}.`);
  }
  return {
    verified: true,
    strategy: 'full',
    slicesChecked: 1,
    contentLength,
    rootHashHex,
    archiveSha256Hex,
    archiveHashVerified: true,
  };
}

/**
 * Read a response body with a hard byte cap enforced DURING streaming -
 * the reader is cancelled the moment the cap is exceeded, so a hostile
 * host cannot exhaust memory before the check runs.
 */
async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  if (!res.body) {
    // No streaming body (test seams / older runtimes): fall back to the
    // buffered path - the cap check still applies after the fact.
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > cap) throw new Error(`Response exceeded its ${cap} byte cap.`);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel('response exceeded size cap');
        throw new Error(`Response exceeded its ${cap} byte cap.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export { BAO_SLICE_LEN };
