import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { getEncodedToken } from '@cashu/cashu-ts';

import { decodeCashuToken, hashDecodedToken, safeSumProofAmounts, MAX_PROOF_FIELD_LENGTH, MAX_TOKEN_LENGTH } from './cashu';

// Deterministic fuzz campaign (round 25): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260906, numRuns: 2_000 });

const MINT = 'https://mint.example.com';
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** REAL cashu-ts serialization (the single-mint form this project's tokens use).
 *  Valid envelope + arbitrary proof contents = exactly what an attacker crafts. */
function token(proofs: Array<Record<string, unknown>>, mint = MINT): string {
  return getEncodedToken({ mint, proofs: proofs as never, unit: 'sat' });
}

function proof(i: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: '00ad268c6d1f09e6', amount: 1, secret: `secret-${i}`, C: '02' + 'ab'.repeat(32), ...overrides };
}

const validProofArb = fc
  .record({
    amount: fc.integer({ min: 1, max: 2 ** 20 }),
    secret: fc.stringMatching(/^[a-zA-Z0-9_-]{1,64}$/),
  })
  .map(({ amount, secret }) => proof(0, { amount, secret }));

describe('decodeCashuToken — token/proof fuzzing (round 25)', () => {
  it('P1: totality — arbitrary strings never throw; result is null or a well-formed entry list', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        const r = decodeCashuToken(s);
        if (r !== null) {
          expect(r.length).toBeGreaterThan(0);
          for (const e of r) {
            expect(typeof e.mintUrl).toBe('string');
            expect(e.proofs.length).toBeGreaterThan(0);
            expect(Number.isSafeInteger(e.amount)).toBe(true);
            expect(e.amount).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 5_000 },
    );
  });

  it('P2: hostile fields that survive the wire encoding are filtered by the validity contract', () => {
    // Ground truth (cashu-ts round-trip probe): these mutations REACH the
    // decoder; the encoder itself refuses NaN/2^53/numeric-C. The decoder's
    // isValidProof must reject every survivor.
    const survivors: Array<Record<string, unknown>> = [
      { amount: 0 }, // amount must be > 0
      { amount: '3' }, // amount must be a number
      { secret: 'x'.repeat(MAX_PROOF_FIELD_LENGTH + 1) },
      { C: '' },
      { witness: 'w'.repeat(MAX_PROOF_FIELD_LENGTH + 1) },
    ];
    fc.assert(
      fc.property(fc.subarray(survivors, { minLength: 1, maxLength: survivors.length }), (mutations) => {
        const proofs = mutations.map((m, i) => ({ ...proof(i), ...m }));
        const r = decodeCashuToken(token(proofs));
        expect(r).toBeNull(); // all-hostile token: nothing may surface
      }),
    );
  });

  it('P3: entry amount equals the exact sum of proof amounts (BigInt oracle) when representable', () => {
    fc.assert(
      fc.property(
        fc.array(validProofArb, { minLength: 1, maxLength: 12 }).map((ps) =>
          ps.map((p, i): Record<string, unknown> => ({ ...p, secret: `${p.secret}-${i}` })),
        ),
        (proofs) => {
          const exact = proofs.reduce((acc, p) => acc + BigInt(p.amount as number), 0n);
          if (exact <= BigInt(MAX_SAFE)) {
            const r = decodeCashuToken(token(proofs));
            expect(r).not.toBeNull();
            expect(r![0]!.amount).toBe(Number(exact));
          }
        },
      ),
    );
  });

  it('P4: FAIL-CLOSED overflow — safeSumProofAmounts refuses sums beyond MAX_SAFE_INTEGER', () => {
    // The library path caps wire amounts, but hand-crafted CBOR could carry
    // larger u64s; the unit-level guard is the last line. Pre-fix, the reduce
    // silently returned a rounded total (financial corruption).
    const a = 4_600_000_000_000_001;
    expect(safeSumProofAmounts([{ amount: a }, { amount: a }])).toBeNull();
    expect(safeSumProofAmounts([{ amount: 1 }, { amount: 2 }, { amount: 3 }])).toBe(6);
    // Mixed: valid prefix then overflow — must refuse the WHOLE sum.
    expect(safeSumProofAmounts([{ amount: 1 }, { amount: Number.MAX_SAFE_INTEGER }, { amount: 1 }])).toBeNull();
  });

  it('P5: hashDecodedToken is proof-order-insensitive; secrets distinguish hashes', () => {
    fc.assert(
      fc.property(
        fc.array(validProofArb, { minLength: 2, maxLength: 8 }).map((ps) =>
          ps.map((p, i): Record<string, unknown> => ({ ...p, secret: `${p.secret}-${i}` })),
        ),
        (proofs) => {
          const entries = decodeCashuToken(token(proofs))!;
          const h1 = hashDecodedToken(entries);
          const reversed = [{ ...entries[0]!, proofs: [...entries[0]!.proofs].reverse() }];
          expect(hashDecodedToken(reversed)).toBe(h1);
          // Flipping a secret must change the hash (dedup integrity).
          const mutated = JSON.parse(JSON.stringify(entries));
          (mutated[0].proofs[0] as Record<string, unknown>).secret = 'flipped-secret-value';
          expect(hashDecodedToken(mutated)).not.toBe(h1);
        },
      ),
    );
  });

  it('P6: size boundary — beyond MAX_TOKEN_LENGTH is rejected without decoding', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4_000 }), (extra) => {
        const big = 'cashu' + 'A'.repeat(MAX_TOKEN_LENGTH - 4 + extra);
        expect(big.length).toBeGreaterThan(MAX_TOKEN_LENGTH);
        expect(decodeCashuToken(big)).toBeNull();
      }),
    );
  });

  it('P7: mint policy integration — private/non-HTTPS mints are dropped, tokens are not decoded from them', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('http://mint.example.com', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.1', 'https://[::ffff:7f00:1]'),
        validProofArb,
        (badMint, p) => {
          const r = decodeCashuToken(token([p], badMint));
          expect(r).toBeNull();
        },
      ),
    );
  });

  it('P8: cashu-prefixed garbage (attacker serialization) is always null — never a throw or a bypass', () => {
    // The raw-JSON V2 path is disproven (cashu-ts: "Token version is not
    // supported"), so the realistic hostile input is token-SHAPED garbage:
    // valid prefix + arbitrary base64/CBOR body.
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.split('')), { minLength: 1, maxLength: 600 }).map((a) => a.join('')),
        (body) => {
          expect(decodeCashuToken('cashu' + body)).toBeNull();
        },
      ),
      { numRuns: 5_000 },
    );
  });
});
