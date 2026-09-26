import { describe, expect, it } from 'vitest';
import {
  encodeEvidence,
  decodeEvidence,
  sliceEvidence,
  verifySlice,
  spotCheckPlan,
  BAO_SLICE_LEN,
} from './baoEvidence';

function bytes(n: number, seed = 42): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x % 251;
  }
  return out;
}

describe('encodeEvidence', () => {
  it('produces a 32-byte root hash and hex form', () => {
    const e = encodeEvidence(bytes(1000));
    expect(e.rootHash.length).toBe(32);
    expect(e.rootHashHex).toMatch(/^[0-9a-f]{64}$/);
    expect(e.contentLength).toBe(1000);
  });

  it('encoding overhead is small (tree bytes only)', () => {
    const e = encodeEvidence(bytes(100_000));
    // BLAKE3 tree overhead for 100 KB is ~6.2% (1 KiB chunk groups); still
    // tiny in absolute terms and the price of seekable verification.
    expect(e.encoded.length).toBeLessThan(100_000 * 1.07);
    expect(e.encoded.length).toBeGreaterThan(100_000);
  });

  it('is deterministic: same bytes → same root hash', () => {
    const a = encodeEvidence(bytes(5000, 7));
    const b = encodeEvidence(bytes(5000, 7));
    expect(a.rootHashHex).toBe(b.rootHashHex);
  });

  it('different bytes → different root hash', () => {
    const a = encodeEvidence(bytes(5000, 7));
    const b = encodeEvidence(bytes(5000, 8));
    expect(a.rootHashHex).not.toBe(b.rootHashHex);
  });
});

describe('decodeEvidence', () => {
  it('round-trips content', () => {
    const content = bytes(7777);
    const e = encodeEvidence(content);
    const out = decodeEvidence(e.encoded, e.rootHash);
    expect(Buffer.from(out).equals(Buffer.from(content))).toBe(true);
  });

  it('rejects a corrupted byte anywhere in the encoding', () => {
    const e = encodeEvidence(bytes(5000));
    const bad = e.encoded.slice();
    bad[1234] ^= 0xff;
    expect(() => decodeEvidence(bad, e.rootHash)).toThrow();
  });

  it('rejects the wrong root hash', () => {
    const e = encodeEvidence(bytes(1000));
    const wrong = e.rootHash.slice();
    wrong[0] ^= 0x01;
    expect(() => decodeEvidence(e.encoded, wrong)).toThrow();
  });
});

describe('slices', () => {
  it('extracts and verifies an arbitrary slice against the published root', () => {
    const content = bytes(50_000);
    const e = encodeEvidence(content);
    const start = 12_345;
    const len = 4096;
    const slice = sliceEvidence(e.encoded, start, len);
    const out = verifySlice(e.rootHash, start, len, slice);
    expect(Buffer.from(out).equals(Buffer.from(content.slice(start, start + len)))).toBe(true);
  });

  it('a tampered slice fails verification', () => {
    const content = bytes(50_000);
    const e = encodeEvidence(content);
    const slice = sliceEvidence(e.encoded, 0, 4096);
    const bad = slice.slice();
    bad[10] ^= 0xff;
    expect(() => verifySlice(e.rootHash, 0, 4096, bad)).toThrow();
  });

  it('verifies many independent slices (spot-check pattern)', () => {
    const content = bytes(200_000);
    const e = encodeEvidence(content);
    for (const { start, len } of spotCheckPlan(200_000, 10)) {
      const slice = sliceEvidence(e.encoded, start, len);
      const out = verifySlice(e.rootHash, start, len, slice);
      expect(Buffer.from(out).equals(Buffer.from(content.slice(start, start + len)))).toBe(true);
    }
  });
});

describe('spotCheckPlan', () => {
  it('returns evenly spaced in-bounds probes', () => {
    const plan = spotCheckPlan(200_000, 10);
    expect(plan).toHaveLength(10);
    for (const p of plan) {
      expect(p.len).toBe(BAO_SLICE_LEN);
      expect(p.start).toBeGreaterThanOrEqual(0);
      expect(p.start + p.len).toBeLessThanOrEqual(200_000);
    }
    // strictly increasing starts
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].start).toBeGreaterThan(plan[i - 1].start);
    }
  });

  it('small artifacts get a single full-coverage probe', () => {
    const plan = spotCheckPlan(1000, 10);
    expect(plan).toEqual([{ start: 0, len: 1000 }]);
  });

  it('degenerate inputs return empty plans', () => {
    expect(spotCheckPlan(0, 5)).toEqual([]);
    expect(spotCheckPlan(1000, 0)).toEqual([]);
  });
});
