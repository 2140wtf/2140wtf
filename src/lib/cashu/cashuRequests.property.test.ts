import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { extractCashuToken, parseCashuPaymentRequestPayload, isEncodedCashuToken } from './cashuRequests';
import { decodeCashuToken, MAX_TOKEN_LENGTH } from './cashu';

// Deterministic fuzz campaign (round 25): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260906, numRuns: 2_000 });

const base64ishArb = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.split('')), {
    minLength: 1,
    maxLength: 300,
  })
  .map((a) => a.join(''));

describe('extractCashuToken — DM-content fuzzing (round 25)', () => {
  it('P1: totality — arbitrary strings yield null or the trimmed input, never throw', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (content) => {
        const r = extractCashuToken(content);
        if (r !== null) {
          expect(r).toBe(content.trim());
          expect(typeof r).toBe('string');
        }
      }),
      { numRuns: 5_000 },
    );
  });

  it('P2: oversize content is rejected without invoking the decoder', () => {
    fc.assert(
      fc.property(base64ishArb, fc.integer({ min: MAX_TOKEN_LENGTH + 1, max: MAX_TOKEN_LENGTH + 5_000 }), (b64, extra) => {
        const filler = 'cashu' + b64;
        const big = (filler + 'A'.repeat(extra)).slice(0, MAX_TOKEN_LENGTH + 1 + (extra % 997));
        expect(big.length).toBeGreaterThan(MAX_TOKEN_LENGTH);
        expect(extractCashuToken(big)).toBeNull();
      }),
    );
  });

  it('P3: consistency — anything extractCashuToken accepts must decode under the hardened decoder', () => {
    fc.assert(
      fc.property(base64ishArb, (b64) => {
        const candidate = 'cashu' + b64;
        const extracted = extractCashuToken(candidate);
        if (extracted !== null) {
          expect(decodeCashuToken(extracted)).not.toBeNull();
        }
      }),
    );
  });

  it('P4: isEncodedCashuToken is a pure predicate — never throws, boolean result', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        expect(typeof isEncodedCashuToken(s)).toBe('boolean');
      }),
      { numRuns: 5_000 },
    );
  });
});

describe('parseCashuPaymentRequestPayload — payload fuzzing (round 25)', () => {
  it('P5: totality — arbitrary strings yield null or a well-shaped payload, never throw', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (content) => {
        const r = parseCashuPaymentRequestPayload(content);
        if (r !== null) {
          const rec = r as unknown as Record<string, unknown>;
          expect(typeof rec.mint).toBe('string');
          expect(Array.isArray(rec.proofs)).toBe(true);
        }
      }),
      { numRuns: 5_000 },
    );
  });

  it('P6: well-shaped JSON payloads with hostile nested values stay shape-valid or null', () => {
    const hostileValue = fc.oneof(
      fc.string({ maxLength: 60 }),
      fc.integer(),
      fc.array(fc.string({ maxLength: 20 }), { maxLength: 5 }),
      fc.constant({ __proto__: 'polluted', mint: 'x' }),
    );
    fc.assert(
      fc.property(hostileValue, hostileValue, (mint, proofs) => {
        const json = JSON.stringify({ mint, proofs });
        const r = parseCashuPaymentRequestPayload(json);
        if (r !== null) {
          expect(typeof r.mint).toBe('string');
          expect(Array.isArray(r.proofs)).toBe(true);
          expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        }
      }),
    );
  });
});
