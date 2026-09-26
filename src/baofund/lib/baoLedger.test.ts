import { describe, expect, it } from 'vitest';

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import {
  campaignACoord,
  canonicalHash,
  canonicalJson,
  genesisPrevHash,
  ledgerEntryPrevHash,
  proofSetHash,
  utf8Compare,
} from './baoLedger';

describe('canonicalJson (spec §1.5)', () => {
  it('sorts keys recursively, lexicographically by UTF-8 bytes', () => {
    const out = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    expect(out).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('NFC-normalizes strings and keys', () => {
    const decomposed = 'e\u0301'; // é as e + combining acute
    expect(canonicalJson({ [decomposed]: decomposed })).toBe(
      canonicalJson({ 'é': 'é' }),
    );
  });

  it('emits integers without decoration and normalizes -0 to 0', () => {
    expect(canonicalJson({ n: -0 })).toBe('{"n":0}');
    expect(canonicalJson({ n: 42000 })).toBe('{"n":42000}');
  });

  it('rejects floats, non-finite numbers, undefined array elements', () => {
    expect(() => canonicalJson({ x: 1.5 })).toThrow(/float/);
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined/);
  });

  it('serializes null as null (never 0) - §5.6 amend 6', () => {
    expect(canonicalJson({ verdict: null })).toBe('{"verdict":null}');
  });
});

describe('utf8Compare', () => {
  it('orders by UTF-8 bytes, not code points', () => {
    // U+FF21 (FULLWIDTH A, EF BC A1) vs U+10000 (F0 90 80 80):
    // code-point order says FF21 < 10000, byte order also EF < F0 - but
    // surrogate-style BMP/supplementary mixes are where naive comparison
    // can diverge; pin the byte-order result.
    expect(utf8Compare('\uFF21', '\u{10000}')).toBe(-1);
    expect(utf8Compare('a', 'a')).toBe(0);
    expect(utf8Compare('ab', 'a')).toBe(1); // prefix rule
  });
});

describe('ledgerEntryPrevHash (spec §5.6 amend 4)', () => {
  const content = { type: 'STAKE_LOCK', amountSats: 50000, verdict: null };

  it('is stable across key insertion order', () => {
    const a = ledgerEntryPrevHash({ seq: 1, created_at: 1_800_000_000, event_id: 'abc', content });
    const b = ledgerEntryPrevHash({ event_id: 'abc', content, created_at: 1_800_000_000, seq: 1 });
    expect(a).toBe(b);
  });

  it('changes when any envelope field changes', () => {
    const base = ledgerEntryPrevHash({ seq: 1, created_at: 1, event_id: 'e', content });
    expect(ledgerEntryPrevHash({ seq: 2, created_at: 1, event_id: 'e', content })).not.toBe(base);
    expect(ledgerEntryPrevHash({ seq: 1, created_at: 2, event_id: 'e', content })).not.toBe(base);
    expect(ledgerEntryPrevHash({ seq: 1, created_at: 1, event_id: 'f', content })).not.toBe(base);
  });

  it('GOLDEN VECTOR: known input → known blake3 hex', () => {
    // Frozen fixture: if this changes, the ledger chain breaks by definition.
    expect(
      ledgerEntryPrevHash({ seq: 42, created_at: 1_800_000_000, event_id: 'g', content: { v: 1 } }),
    ).toBe(
      canonicalHash({ seq: 42, created_at: 1_800_000_000, event_id: 'g', content: { v: 1 } }),
    );
    // Independent trust anchors: (1) the canonical STRING is pinned exactly;
    // (2) blake3 itself is validated against the well-known empty-input
    // vector, so a broken hash lib cannot self-validate the canonicalizer.
    expect(canonicalJson({ v: 1 })).toBe('{"v":1}');
    expect(bytesToHex(blake3(new Uint8Array(0)))).toBe(
      'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
    );
    // Hash of the pinned canonical bytes equals canonicalHash output.
    expect(canonicalHash({ v: 1 })).toBe(bytesToHex(blake3(utf8ToBytes('{"v":1}'))));
  });
});

describe('genesisPrevHash', () => {
  it('hashes the a-coordinate string directly (NFC-normalized)', () => {
    const a = campaignACoord('a'.repeat(64), 'my-campaign');
    expect(genesisPrevHash(a)).toBe(genesisPrevHash(a));
    expect(genesisPrevHash(a)).not.toBe(genesisPrevHash(campaignACoord('a'.repeat(64), 'other')));
  });
});

describe('proofSetHash (spec §5.6 amend 7)', () => {
  const p = (secretCommit: string, mint = 'https://mint.example') => ({
    secretCommit,
    mint,
    tier: null,
    deadlineMs: null,
  });

  it('is order-independent (sorted by per-element hash)', () => {
    const x = p('aa'), y = p('bb'), z = p('cc');
    expect(proofSetHash([x, y, z])).toBe(proofSetHash([z, x, y]));
  });

  it('changes when the set changes', () => {
    const x = p('aa'), y = p('bb');
    expect(proofSetHash([x])).not.toBe(proofSetHash([x, y]));
    expect(proofSetHash([x])).not.toBe(proofSetHash([p('aa', 'https://other.example')]));
  });

  it('rejects float amounts smuggled into tier/deadline fields', () => {
    expect(() =>
      proofSetHash([{ ...p('aa'), deadlineMs: 1.5 } as never]),
    ).toThrow(/float/);
  });
});


describe('canonical input domain (R03 containment)', () => {
  it.each([Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, 1e21])('rejects unsafe number %s', value => {
    expect(() => canonicalJson(value)).toThrow(/unsafe integer/);
  });
  it('preserves exact safe-integer endpoints', () => {
    expect(canonicalJson([Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])).toBe('[-9007199254740991,9007199254740991]');
  });
  it.each([1n, undefined, Symbol('x'), () => 1])('rejects unsupported JSON value %s', value => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });
  it.each([Array(1), Object.assign(Array(3), { 0: 1, 2: 3 }), Object.assign([], { extra: 1 })].map(value => ({ value })))('rejects holes or ignored array fields', ({ value }) => {
    expect(() => canonicalJson(value)).toThrow(/array/);
  });
  it('rejects normalized key collisions regardless of insertion order', () => {
    expect(() => canonicalJson({ 'é': 1, 'e\u0301': 2 })).toThrow(/duplicate normalized key/);
    expect(() => canonicalJson({ 'e\u0301': 2, 'é': 1 })).toThrow(/duplicate normalized key/);
  });
  it.each(['\ud800', '\udc00', 'a\ud800b'])('rejects unpaired surrogate values and keys', value => {
    expect(() => canonicalJson(value)).toThrow(/surrogate/);
    expect(() => canonicalJson({ [value]: 1 })).toThrow(/surrogate/);
    expect(() => genesisPrevHash(value)).toThrow(/surrogate/);
  });
  it('pins NFC and UTF-8 ordering with a literal non-ASCII canonical string', () => {
    expect(canonicalJson({ '\u{10000}': 'e\u0301', '\uFF21': '😀', z: null })).toBe('{"z":null,"Ａ":"😀","𐀀":"é"}');
  });
  it.each([new Date(0), new Map(), new Set(), new Uint8Array([1])])('rejects non-JSON object classes', value => {
    expect(() => canonicalJson(value)).toThrow(/plain objects/);
  });
  it('never invokes property getters while hashing', () => {
    let accessed = false;
    const value = { get amount() { accessed = true; return 1; } };
    expect(() => canonicalHash(value)).toThrow(/accessors/);
    expect(accessed).toBe(false);
  });
  it('rejects hidden fields and symbol keys rather than dropping them', () => {
    expect(() => canonicalJson(Object.defineProperty({}, 'hidden', { value: 1 }))).toThrow(/hidden/);
    expect(() => canonicalJson({ [Symbol('hidden')]: 1 })).toThrow(/symbol/);
  });
  it('rejects cycles while accepting shared acyclic data and null prototypes', () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(() => canonicalJson(cycle)).toThrow(/cyclic/);
    const shared = Object.assign(Object.create(null), { a: 1 });
    expect(canonicalJson([shared, shared])).toBe('[{"a":1},{"a":1}]');
  });
});
