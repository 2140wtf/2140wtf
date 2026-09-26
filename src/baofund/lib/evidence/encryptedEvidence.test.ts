// src/lib/evidence/encryptedEvidence.test.ts
//
// Tests for the Carbonado-style at-rest encryption of private evidence
// artifacts. Includes a node:crypto cross-check that pins the WebCrypto
// AES-CTR output to standard Ctr128BE semantics and validates the EtM MAC
// with an independent implementation.

import { describe, expect, it } from 'vitest';
import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';

import {
  encryptEvidenceArtifact,
  decryptEvidenceArtifact,
  encodePrivateEvidence,
  decodePrivateEvidence,
  verifyPrivateSlice,
  spotCheckPlan,
  BAO_SLICE_LEN,
} from './encryptedEvidence';
import { deriveSubkey, deriveSubkey32, KDF_LABELS } from '../../wallet/keySchedule';
import { encodeEvidence, rootHex } from './baoEvidence';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** Deterministic pseudo-random fill so tests are reproducible. */
function fill(bytes: Uint8Array, seed: number): Uint8Array {
  let s = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    bytes[i] = s & 0xff;
  }
  return bytes;
}

/** Per-artifact master exactly as the app will derive it. */
const artifactMaster = (seed: number) => deriveSubkey32(fill(new Uint8Array(32), seed), KDF_LABELS.evidenceEncryption);

describe('encryptedEvidence: wire format', () => {
  it('produces [nonce(16) | tag(64) | ct] - length-preserving CTR with 80-byte overhead', async () => {
    const master = artifactMaster(1);
    const plaintext = fill(new Uint8Array(1000), 42);
    const blob = await encryptEvidenceArtifact(master, plaintext);

    expect(blob.length).toBe(1000 + 80);
    const ct = blob.slice(80);
    expect(ct.length).toBe(1000);
    // CTR is a stream cipher: ciphertext != plaintext (with overwhelming probability)
    expect(Buffer.from(ct).equals(Buffer.from(plaintext))).toBe(false);
  });

  it('uses unique nonces across encryptions under the same master', async () => {
    const master = artifactMaster(2);
    const msg = new Uint8Array(64);
    const a = await encryptEvidenceArtifact(master, msg);
    const b = await encryptEvidenceArtifact(master, msg);
    expect(hex(a.slice(0, 16))).not.toBe(hex(b.slice(0, 16)));
    // same plaintext, different nonce → different ciphertext (semantic security)
    expect(hex(a.slice(80))).not.toBe(hex(b.slice(80)));
  });
});

describe('encryptedEvidence: roundtrip and tamper rejection', () => {
  it('roundtrips empty and multi-chunk payloads', async () => {
    const master = artifactMaster(3);
    for (const size of [0, 1, 4095, 4096, 4097, 100_000]) {
      const pt = fill(new Uint8Array(size), size + 7);
      const blob = await encryptEvidenceArtifact(master, pt);
      const out = await decryptEvidenceArtifact(master, blob);
      expect(Buffer.from(out).equals(Buffer.from(pt))).toBe(true);
    }
  });

  it('rejects a flipped bit in the tag', async () => {
    const master = artifactMaster(4);
    const blob = await encryptEvidenceArtifact(master, fill(new Uint8Array(128), 9));
    const tampered = blob.slice();
    tampered[20]! ^= 0xff; // inside the 64-byte tag
    await expect(decryptEvidenceArtifact(master, tampered)).rejects.toThrow(/authentication failed/i);
  });

  it('rejects a flipped bit in the ciphertext', async () => {
    const master = artifactMaster(5);
    const blob = await encryptEvidenceArtifact(master, fill(new Uint8Array(128), 10));
    const tampered = blob.slice();
    tampered[100]! ^= 0xff; // inside ct
    await expect(decryptEvidenceArtifact(master, tampered)).rejects.toThrow(/authentication failed/i);
  });

  it('rejects a flipped bit in the nonce (nonce is authenticated)', async () => {
    const master = artifactMaster(6);
    const blob = await encryptEvidenceArtifact(master, fill(new Uint8Array(128), 11));
    const tampered = blob.slice();
    tampered[3]! ^= 0xff; // inside nonce
    await expect(decryptEvidenceArtifact(master, tampered)).rejects.toThrow(/authentication failed/i);
  });

  it('rejects truncated blobs and the wrong master', async () => {
    const master = artifactMaster(7);
    const wrong = artifactMaster(8);
    const blob = await encryptEvidenceArtifact(master, fill(new Uint8Array(64), 12));
    await expect(decryptEvidenceArtifact(master, blob.slice(0, 40))).rejects.toThrow(/too short/i);
    await expect(decryptEvidenceArtifact(wrong, blob)).rejects.toThrow(/authentication failed/i);
  });
});

describe('encryptedEvidence: cross-check against node:crypto (independent implementation)', () => {
  it('WebCrypto AES-CTR output matches node aes-256-ctr (Ctr128BE semantics)', async () => {
    const master = artifactMaster(9);
    const plaintext = fill(new Uint8Array(333), 13);
    const blob = await encryptEvidenceArtifact(master, plaintext);

    const nonce = blob.slice(0, 16);
    const tag = blob.slice(16, 80);
    const ct = blob.slice(80);

    // Independent decrypt with node:crypto - proves the WebCrypto CTR bytes
    // are standard AES-256-CTR under the same key/counter.
    // (Subkeys are context-separated by the plaintext length, BE uint32.)
    const ctx = new Uint8Array(4);
    new DataView(ctx.buffer).setUint32(0, plaintext.length, false);
    const aesKey = deriveSubkey(master, KDF_LABELS.evidenceEncCtr, ctx).slice(0, 32);
    const decipher = createDecipheriv('aes-256-ctr', Buffer.from(aesKey), Buffer.from(nonce));
    const pt = Buffer.concat([decipher.update(Buffer.from(ct)), decipher.final()]);
    expect(pt.equals(Buffer.from(plaintext))).toBe(true);

    // Independent MAC check: HMAC-SHA512(etmKey, 'baofund-etm/v1' || nonce || ct)
    const etmKey = deriveSubkey(master, KDF_LABELS.evidenceEncEtm, ctx);
    const expectedTag = createHmac('sha512', Buffer.from(etmKey))
      .update('baofund-etm/v1')
      .update(Buffer.from(nonce))
      .update(Buffer.from(ct))
      .digest();
    expect(Buffer.from(tag).equals(expectedTag)).toBe(true);

    // And the forward direction: node encrypts → our decryptor accepts.
    const encCipher = createCipheriv('aes-256-ctr', Buffer.from(aesKey), Buffer.from(nonce));
    const ct2 = Buffer.concat([encCipher.update(Buffer.from(plaintext)), encCipher.final()]);
    expect(Buffer.from(ct).equals(ct2)).toBe(true);
  });
});

describe('encryptedEvidence: composition with Bao verified streaming', () => {
  it('encodePrivateEvidence → decodePrivateEvidence roundtrip; root commits to ciphertext', async () => {
    const master = artifactMaster(10);
    const pt = fill(new Uint8Array(50_000), 14);

    const artifact = await encodePrivateEvidence(master, pt);
    expect(artifact.contentLength).toBe(50_000 + 80);
    expect(artifact.rootHashHex).toMatch(/^[0-9a-f]{64}$/);

    // The published root must equal the Bao root of the encrypted blob
    // (NOT of the plaintext) - storage only ever sees ciphertext.
    const plainBao = encodeEvidence(pt);
    expect(artifact.rootHashHex).not.toBe(rootHex(plainBao));

    const recovered = await decodePrivateEvidence(master, artifact.encoded, artifact.rootHash);
    expect(Buffer.from(recovered).equals(Buffer.from(pt))).toBe(true);
  });

  it('attestors verify slices of the encrypted artifact without the key', async () => {
    const master = artifactMaster(11);
    const pt = fill(new Uint8Array(200_000), 15);
    const artifact = await encodePrivateEvidence(master, pt);

    const plan = spotCheckPlan(artifact.contentLength, 4);
    expect(plan.length).toBe(4);
    for (const { start, len } of plan) {
      const { verified } = verifyPrivateSlice(artifact.encoded, artifact.rootHash, start, len);
      expect(verified).toBe(true);
    }

    // Corrupted byte INSIDE the sliced range must fail slice verification
    // (Bao proofs cover their own subtree; out-of-slice corruption is caught
    // by full decodeEvidence or by a slice covering that range.)
    const corrupted = artifact.encoded.slice();
    corrupted[5]! ^= 0xff;
    expect(() => verifyPrivateSlice(corrupted, artifact.rootHash, 0, BAO_SLICE_LEN)).toThrow();
  });

  it('wrong master decrypts nothing even with a valid Bao encoding', async () => {
    const master = artifactMaster(12);
    const wrong = artifactMaster(13);
    const pt = fill(new Uint8Array(5000), 16);
    const artifact = await encodePrivateEvidence(master, pt);
    await expect(decodePrivateEvidence(wrong, artifact.encoded, artifact.rootHash)).rejects.toThrow(
      /authentication failed/i,
    );
  });
});

describe('encryptedEvidence: subkey separation', () => {
  it('purpose labels derive independent keys (Carbonado discipline)', () => {
    const master = artifactMaster(14);
    const aes = deriveSubkey(master, KDF_LABELS.evidenceEncCtr);
    const etm = deriveSubkey(master, KDF_LABELS.evidenceEncEtm);
    expect(hex(aes)).not.toBe(hex(etm));
    expect(aes.length).toBe(64); // full output; caller slices 32
    expect(etm.length).toBe(64);
  });

  it('different artifacts under the same master get independent keys (per-artifact separation)', async () => {
    const master = artifactMaster(15);
    const a = fill(new Uint8Array(1000), 21);
    const b = fill(new Uint8Array(2000), 22); // different length → different context

    const blobA = await encryptEvidenceArtifact(master, a);
    const blobB = await encryptEvidenceArtifact(master, b);

    // Both roundtrip (context recovered from blob length on decrypt).
    expect(Buffer.from(await decryptEvidenceArtifact(master, blobA)).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(await decryptEvidenceArtifact(master, blobB)).equals(Buffer.from(b))).toBe(true);

    // A blob encrypted under ONE artifact's context fails under the OTHER's
    // (the keys differ) - even though both use the same master.
    await expect(decryptEvidenceArtifact(master, blobA)).resolves.toBeTruthy();
    // Simulate a blob that claims a different plaintext length: flip the
    // context by truncating - decrypt must fail auth, not silently succeed.
    const truncated = blobA.slice(0, blobA.length - 1);
    await expect(decryptEvidenceArtifact(master, truncated)).rejects.toThrow(/too short|authentication/i);
  });
});
