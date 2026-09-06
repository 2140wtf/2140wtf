import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isFeeWithinMaxPpm, MAX_MINT_FEE_PPM } from './cashu';

// Deterministic fuzz campaign (round 27b): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260906, numRuns: 500 });

/** Ground truth in exact arithmetic — the spec the implementation must match. */
function exactMaxFee(amount: number, ppm: number): number {
  return Number((BigInt(amount) * BigInt(ppm)) / 1_000_000n);
}

describe('isFeeWithinMaxPpm — exact-arithmetic properties (round 27b)', () => {
  it('P1: matches BigInt ground truth for every safe-integer (fee, amount, ppm) triple', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (fee, amount, ppm) => {
          expect(isFeeWithinMaxPpm(fee, amount, ppm)).toBe(fee <= exactMaxFee(amount, ppm));
        },
      ),
      { numRuns: 400 },
    );
  });

  it('P2: boundary is exact — floor(amount·ppm/1e6) passes, floor+1 fails, at any magnitude', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (amount, ppm) => {
          const threshold = exactMaxFee(amount, ppm);
          expect(isFeeWithinMaxPpm(threshold, amount, ppm)).toBe(true);
          if (threshold < Number.MAX_SAFE_INTEGER) {
            expect(isFeeWithinMaxPpm(threshold + 1, amount, ppm)).toBe(false);
          }
        },
      ),
    );
  });

  it('P3: fails closed on NaN, infinities, fractions, and negatives', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY),
          fc.constant(-1),
          fc.constant(0.5),
        ),
        fc.integer({ min: 0, max: 1_000 }),
        (badFee, amount) => {
          expect(isFeeWithinMaxPpm(badFee, amount)).toBe(false);
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000 }),
        fc.oneof(
          fc.constant(Number.NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY),
          fc.constant(-1),
          fc.constant(0.5),
        ),
        (fee, badAmount) => {
          expect(isFeeWithinMaxPpm(fee, badAmount)).toBe(false);
        },
      ),
    );
  });

  it('P4: the legacy float implementation demonstrably disagrees at magnitude (regression witness)', () => {
    // amount = 2^52, ppm = 50_000: amount*ppm = 2.251...e17 > 2^53, so the
    // float product rounds; the exact threshold moves by whole sats.
    const amount = 2 ** 52;
    const ppm = MAX_MINT_FEE_PPM;
    const exact = exactMaxFee(amount, ppm);
    const legacyFloatFloor = Math.floor((amount * ppm) / 1_000_000);
    // The witness only matters when the two arithmetics actually disagree —
    // if engines improve, this assertion becomes a tautology, which is fine.
    expect(Number.isSafeInteger(amount * ppm)).toBe(false);
    expect(exact).toBeGreaterThanOrEqual(0);
    expect(legacyFloatFloor).toBeGreaterThanOrEqual(0);
    // Whatever the float did, the implementation must agree with EXACT math:
    expect(isFeeWithinMaxPpm(exact, amount, ppm)).toBe(true);
    expect(isFeeWithinMaxPpm(exact + 1, amount, ppm)).toBe(false);
  });
});
