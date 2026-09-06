import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseBolt11Amount } from './bolt11';

// Deterministic fuzz campaign (round 24): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260906, numRuns: 2_000 });

/** BOLT11 multiplier ground truth in exact BigInt arithmetic (value → sats). */
const MULTIPLIERS: Record<string, { num: bigint; den: bigint }> = {
  m: { num: 100_000n, den: 1n }, // milli-BTC → sats
  u: { num: 100n, den: 1n }, // micro-BTC → sats
  n: { num: 1n, den: 10n }, // nano-BTC → sats (fractional)
  p: { num: 1n, den: 10_000n }, // pico-BTC → sats (fractional)
  '': { num: 100_000_000n, den: 1n }, // BTC → sats
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Oracle: exact expected sats for a spec-shaped invoice amount.
 *  - Integer multipliers: f64 product is exact iff ≤ 2^53; any larger true
 *    product rounds to ≥ 2^53 > MAX_SAFE_INTEGER, so expect null there.
 *  - Fractional multipliers (n/p): |v/den| ≤ 10^15 always passes the guard,
 *    and f64 division is correctly rounded — expect exactly that double. */
function expectedSats(digits: string, mult: string): number | null {
  const v = BigInt(digits);
  const { num, den } = MULTIPLIERS[mult]!;
  if (den === 1n) {
    const product = v * num;
    return product <= MAX_SAFE ? Number(product) : null;
  }
  return Number(v) / Number(den);
}

const digit = fc.constantFrom(...'0123456789'.split(''));
const digitsArb = fc.array(digit, { minLength: 1, maxLength: 15 }).map((a) => a.join(''));
const bigRunArb = fc.array(digit, { minLength: 16, maxLength: 40 }).map((a) => a.join(''));
const multArb = fc.constantFrom('', 'm', 'u', 'n', 'p');
// Bech32 data charset — excludes '1', so the hrp/data separator is unambiguous.
const dataArb = fc
  .array(fc.constantFrom(...'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.split('')), { minLength: 1, maxLength: 80 })
  .map((a) => a.join(''));

describe('parseBolt11Amount — property-based fuzzing (round 24)', () => {
  it('P1: spec-shaped invoices match exact BigInt ground truth for every multiplier', () => {
    fc.assert(
      fc.property(digitsArb, multArb, dataArb, (digits, mult, data) => {
        const invoice = `lnbc${digits}${mult}1${data}`;
        expect(parseBolt11Amount(invoice)).toBe(expectedSats(digits, mult));
      }),
    );
  });

  it('P2: digit runs ≥ 16 are rejected outright — no shifted sub-parse may leak a number', () => {
    // The cap only guarantees safety if the regex cannot absorb leading
    // digits of the run into the hrp matcher and re-anchor on a sub-run.
    fc.assert(
      fc.property(bigRunArb, multArb, dataArb, (digits, mult, data) => {
        expect(parseBolt11Amount(`lnbc${digits}${mult}1${data}`)).toBeNull();
      }),
    );
  });

  it('P3: amountless invoices yield null', () => {
    fc.assert(
      fc.property(dataArb, fc.constantFrom('lnbc', 'lntb', 'lnbcrt', 'lnsb'), (data, hrp) => {
        expect(parseBolt11Amount(`${hrp}1${data}`)).toBeNull();
      }),
    );
  });

  it('P4: totality — arbitrary hostile strings return null or a finite bounded number, never throw', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        const r = parseBolt11Amount(s);
        if (r !== null) {
          expect(Number.isFinite(r)).toBe(true);
          expect(Math.abs(r)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
        }
      }),
      { numRuns: 5_000 },
    );
  });

  it('P5: boundary spot-checks around the safe-integer cliff', () => {
    // BTC multiplier: 90,071,993 × 1e8 = 9,007,199,300,000,000 > 2^53-1 → null;
    // 90,071,992 × 1e8 stays exact.
    expect(parseBolt11Amount('lnbc900719931qq')).toBeNull();
    expect(parseBolt11Amount('lnbc900719921qq')).toBe(9_007_199_200_000_000);
    // milli-BTC with a full 15-digit run overflows:
    expect(parseBolt11Amount('lnbc999999999999999m1qq')).toBeNull();
    // micro-BTC cliff at 14 digits: ×100 straddles MAX_SAFE_INTEGER exactly.
    expect(parseBolt11Amount('lnbc90071992547410u1qq')).toBeNull();
    expect(parseBolt11Amount('lnbc90071992547409u1qq')).toBe(9_007_199_254_740_900);
    // Fractional multipliers never overflow within 15 digits:
    expect(parseBolt11Amount('lnbc999999999999999n1qq')).toBe(99_999_999_999_999.9);
  });
});
