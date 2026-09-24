/**
 * C7 conformance - evidence bundle tamper-negative selftest (§33.2/§34
 * week-1 order item 3). The evidence pipeline's entire value is that tampered
 * bytes are DETECTED; this suite is the adversarial battery that must keep
 * failing-open-proof: every corruption class below MUST throw, every layer
 * (bao tree, slice proofs, attestation tag parsing, at-rest encryption) MUST
 * reject. A green run here is the C7 gate; a tamper class that ever starts
 * passing is a release blocker.
 *
 * Corpus: deterministic pseudo-random bytes + pathological shapes (empty-ish,
 * exact slice boundary, multi-chunk) so boundary bugs can't hide.
 */
import { describe, expect, it } from 'vitest';

import {
  BAO_SLICE_LEN,
  decodeEvidence,
  encodeEvidence,
  sliceEvidence,
  spotCheckPlan,
  verifySlice,
} from './baoEvidence';
import {
  buildEvidenceTag,
  encodeMilestoneEvidence,
  parseEvidenceTag,
  verifyMilestoneEvidenceArtifact,
} from './attestationEvidence';
import { decryptEvidenceArtifact, encryptEvidenceArtifact } from './encryptedEvidence';

function bytes(n: number, seed = 42): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x % 251;
  }
  return out;
}

/** Flip one byte at `pos` (XOR 0xff - cannot alias to the same value). */
function flip(src: Uint8Array, pos: number): Uint8Array {
  const out = new Uint8Array(src);
  out[pos] = out[pos] ^ 0xff;
  return out;
}

const CORPUS = {
  tiny: bytes(64, 11), // < 1 slice
  exactSlice: bytes(BAO_SLICE_LEN, 12), // exactly 1 slice boundary
  multiChunk: bytes(BAO_SLICE_LEN * 3 + 777, 13), // several chunks + remainder
};

describe('C7: full-decode tamper negatives', () => {
  for (const [name, content] of Object.entries(CORPUS)) {
    it(`rejects a flipped content byte (${name})`, () => {
      const e = encodeEvidence(content);
      const tampered = flip(e.encoded, 5);
      expect(() => decodeEvidence(tampered, e.rootHash)).toThrow();
    });
    it(`rejects a flipped byte near the end (${name})`, () => {
      const e = encodeEvidence(content);
      const tampered = flip(e.encoded, e.encoded.length - 1);
      expect(() => decodeEvidence(tampered, e.rootHash)).toThrow();
    });
    it(`rejects truncation (${name})`, () => {
      const e = encodeEvidence(content);
      if (e.encoded.length <= 2) return; // tiny corpus guard
      const truncated = e.encoded.slice(0, e.encoded.length - 8);
      expect(() => decodeEvidence(truncated, e.rootHash)).toThrow();
    });
    it(`rejects verification against a wrong root (${name})`, () => {
      const e = encodeEvidence(content);
      const other = encodeEvidence(bytes(content.length, content.length + 1));
      expect(() => decodeEvidence(e.encoded, other.rootHash)).toThrow();
    });
  }
});

describe('C7: slice-proof tamper negatives', () => {
  it('rejects a tampered slice payload', () => {
    const content = CORPUS.multiChunk;
    const e = encodeEvidence(content);
    const plan = spotCheckPlan(content.length, 3);
    for (const { start, len } of plan) {
      const slice = sliceEvidence(e.encoded, start, len);
      // flip a payload byte (past the proof header, inside the slice body)
      const tampered = flip(slice, slice.length - 1);
      expect(() => verifySlice(e.rootHash, start, len, tampered)).toThrow();
    }
  });
  it('rejects a slice verified against the wrong root', () => {
    const e = encodeEvidence(CORPUS.multiChunk);
    const other = encodeEvidence(bytes(CORPUS.multiChunk.length, 99));
    const slice = sliceEvidence(e.encoded, 0, Math.min(BAO_SLICE_LEN, CORPUS.multiChunk.length));
    expect(() => verifySlice(other.rootHash, 0, slice.length >= 4096 ? BAO_SLICE_LEN : slice.length, slice)).toThrow();
  });
  it('rejects a slice whose claimed offset lies', () => {
    const e = encodeEvidence(CORPUS.multiChunk);
    const slice = sliceEvidence(e.encoded, 0, BAO_SLICE_LEN);
    // the slice from offset 0 must NOT verify as offset 4096
    expect(() => verifySlice(e.rootHash, BAO_SLICE_LEN, BAO_SLICE_LEN, slice)).toThrow();
  });
  it('honest slices verify (control - keeps the negatives honest)', () => {
    const content = CORPUS.multiChunk;
    const e = encodeEvidence(content);
    for (const { start, len } of spotCheckPlan(content.length, 4)) {
      const slice = sliceEvidence(e.encoded, start, len);
      const decoded = verifySlice(e.rootHash, start, len, slice);
      expect(decoded).toEqual(content.slice(start, start + len));
    }
  });
});

describe('C7: attestation tag tamper negatives', () => {
  it('throws on malformed evidence tags (never silently "no evidence")', () => {
    expect(() => parseEvidenceTag([['evidence', 'only-root']])).toThrow();
    expect(() => parseEvidenceTag([['evidence', 'a'.repeat(64), 'bao/blake3-v1']])).toThrow(); // 3 elements
    expect(() => parseEvidenceTag([['evidence', 'ZZ'.repeat(32), 'bao/blake3-v1', '100']])).toThrow(); // non-hex root
  });
  it('buildEvidenceTag accepts well-formed fields (consistency is verify-time, not build-time)', () => {
    const enc = encodeMilestoneEvidence(CORPUS.tiny);
    // The tag builder validates shape, not provenance - a wrong byte-count
    // rides in the tag but MUST then fail artifact verification below.
    const bad = { ...enc.fields, evidence_bytes: enc.fields.evidence_bytes + 1 };
    expect(buildEvidenceTag(bad)[0]).toBe('evidence');
  });
  it('full artifact verification fails when served bytes differ from the commitment', async () => {
    const enc = encodeMilestoneEvidence(CORPUS.tiny);
    const served = flip(enc.encoded, enc.encoded.length - 3);
    // Serve the tampered encoding via the test fetch seam; verification must
    // reject (throw) - never partial credit, never silent pass.
    const fakeFetch: typeof fetch = (async () =>
      new Response(served as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch;
    await expect(
      verifyMilestoneEvidenceArtifact({
        archiveUrl: 'https://archive.example/evidence.bao',
        archiveSha256Hex: enc.archiveSha256Hex,
        rootHashHex: enc.rootHashHex,
        contentLength: enc.contentLength,
        maxFullBytes: 1024 * 1024,
        fetchImpl: fakeFetch,
      }),
    ).rejects.toThrow();
  });
  it('full artifact verification passes on the honest encoding (control)', async () => {
    const enc = encodeMilestoneEvidence(CORPUS.tiny);
    const fakeFetch: typeof fetch = (async () =>
      new Response(enc.encoded as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch;
    const r = await verifyMilestoneEvidenceArtifact({
      archiveUrl: 'https://archive.example/evidence.bao',
      archiveSha256Hex: enc.archiveSha256Hex,
      rootHashHex: enc.rootHashHex,
      contentLength: enc.contentLength,
      maxFullBytes: 1024 * 1024,
      fetchImpl: fakeFetch,
    });
    expect(r.verified).toBe(true);
  });
});

describe('C7: at-rest encryption tamper negatives (EtM MAC)', () => {
  it('rejects any flipped ciphertext byte', async () => {
    const master = bytes(32, 5);
    const plaintext = CORPUS.multiChunk;
    const blob = await encryptEvidenceArtifact(master, plaintext);
    for (const pos of [0, Math.floor(blob.length / 2), blob.length - 1]) {
      const tampered = flip(blob, pos);
      await expect(decryptEvidenceArtifact(master, tampered)).rejects.toThrow();
    }
  });
  it('rejects decryption with the wrong master (key-mix separation)', async () => {
    const blob = await encryptEvidenceArtifact(bytes(32, 5), CORPUS.tiny);
    await expect(decryptEvidenceArtifact(bytes(32, 6), blob)).rejects.toThrow();
  });
  it('rejects truncation (MAC covers length)', async () => {
    const blob = await encryptEvidenceArtifact(bytes(32, 5), CORPUS.tiny);
    const truncated = blob.slice(0, blob.length - 1);
    await expect(decryptEvidenceArtifact(bytes(32, 5), truncated)).rejects.toThrow();
  });
  it('honest round-trip returns the plaintext (control)', async () => {
    const master = bytes(32, 5);
    const blob = await encryptEvidenceArtifact(master, CORPUS.multiChunk);
    const out = await decryptEvidenceArtifact(master, blob);
    expect(out).toEqual(CORPUS.multiChunk);
  });
});
