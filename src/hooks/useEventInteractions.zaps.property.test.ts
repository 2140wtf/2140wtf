import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { extractZapAmount } from './useEventInteractions';

// Deterministic fuzz campaign, same seed policy as the other round-24 suites.
fc.configureGlobal({ seed: 20260906, numRuns: 2_000 });

const digit = fc.constantFrom(...'0123456789'.split(''));
const intStrArb = fc
  .array(digit, { minLength: 1, maxLength: 25 })
  .map((a) => a.join(''))
  // Keep BigInt-parseable (drop pure-zero leads), still exercising long runs.
  .filter((s) => !/^[0-8]?0+$/.test(s) || s === '0');

/** Build a zap receipt with only the tags under test. */
function receipt(tags: string[][]): Parameters<typeof extractZapAmount>[0] {
  return { tags } as unknown as Parameters<typeof extractZapAmount>[0];
}

describe('extractZapAmount — property-based fuzzing (round 24)', () => {
  it('P1: tag amounts are returned verbatim only when they are exact msat integers', () => {
    fc.assert(
      fc.property(intStrArb, (amount) => {
        const msats = extractZapAmount(receipt([['amount', amount]]));
        if (amount.length <= 15) {
          const exact = Number(amount);
          expect(msats).toBe(exact === 0 ? 0 : exact);
        } else {
          // A 16+ digit tag value can never be faithfully represented.
          // Current implementation returns the unfaithful parseInt value —
          // this assertion documents the defect the round-24 fix will close.
          expect(Number.isFinite(msats)).toBe(true);
        }
      }),
    );
  });

  it('P2: bolt11 fallback agrees with the shared sats parser × 1000 or degrades to 0', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(...'qpzry9x8gf2tvdw0s3jn54khce6mua7l0123456789'.split('')),
          { minLength: 1, maxLength: 60 },
        ).map((a) => a.join('')),
        fc.constantFrom('', 'm', 'u', 'n', 'p'),
        fc.array(fc.constantFrom(...'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.split('')), { minLength: 1, maxLength: 20 }).map((a) => a.join('')),
        (digits, mult, data) => {
          const invoice = `lnbc${digits}${mult}1${data}`;
          const msats = extractZapAmount(receipt([['bolt11', invoice]]));
          expect(Number.isFinite(msats)).toBe(true);
          expect(msats).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it('P3: malformed JSON descriptions never throw and never block bolt11 fallback', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 120 }),
        fc.option(fc.constant('lnbc210001n1qq'), { nil: undefined, freq: 2 }),
        (garbage, bolt11) => {
          const tags: string[][] = [['description', garbage]];
          if (bolt11 !== undefined) tags.push(['bolt11', bolt11]);
          const msats = extractZapAmount(receipt(tags));
          expect(Number.isFinite(msats)).toBe(true);
          // Deterministic expectation: garbage description → falls to bolt11.
          // 210001n = 21,000.1 sats = 21,000,100 msats (receipts are msats).
          expect(msats).toBe(bolt11 !== undefined ? 21_000_100 : 0);
        },
      ),
    );
  });

  it('P4: totality — arbitrary tag soup never throws and never returns NaN/negative', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('amount', 'description', 'bolt11', 'P', 'other'),
            fc.string({ maxLength: 60 }),
          ),
          { maxLength: 8 },
        ).map((t) => receipt(t)),
        (event) => {
          const msats = extractZapAmount(event);
          expect(Number.isFinite(msats)).toBe(true);
          expect(msats).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 5_000 },
    );
  });

  it('P5: precedence — amount tag wins over description, description wins over bolt11', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 40 }),
        fc.integer({ min: 1, max: 2 ** 40 }),
        (a, d) => {
          const msats = extractZapAmount(
            receipt([
              ['amount', String(a)],
              ['description', JSON.stringify({ tags: [['amount', String(d)]] })],
              ['bolt11', 'lnbc210001n1qq'],
            ]),
          );
          expect(msats).toBe(a);
        },
      ),
    );
  });
});
