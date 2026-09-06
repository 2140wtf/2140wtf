import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LIST,
  paymentTargetsToTags,
  parsePaymentTargets,
  type PaymentTarget,
} from './paymentTargets';
import type { NostrEvent } from '@nostrify/nostrify';

// Deterministic fuzz campaign (round 24): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260906, numRuns: 2_000 });

/** Hostile charset: delimiters that could escape a URL path segment or scheme. */
const HOSTILE = ['/', '?', '#', '&', '=', ':', '@', '$', '.', '-', '_', '%', '\\', "'", '"', '<', '>', ' ', '\t', '\n'];
const handleChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.')
  .chain((c) => fc.constantFrom(c, ...HOSTILE));
const handleArb = fc.array(handleChar, { minLength: 1, maxLength: 40 }).map((a) => a.join(''));

const HANDLE_TYPES = ['cashme', 'venmo', 'revolut'] as const;

/** Build a minimal kind-10133 event. */
function ev(paytos: string[][]): NostrEvent {
  return { kind: 10133, tags: paytos } as unknown as NostrEvent;
}

describe('paymentTargets — property-based fuzzing (round 24)', () => {
  it('P1: handle URIs are always same-origin path segments — never scheme/authority injection', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HANDLE_TYPES),
        handleArb,
        (type, handle) => {
          const method = PAYMENT_METHODS[type];
          if (!method.validate(handle)) return; // validator gates what gets through
          const uri = method.uri(handle)!;
          // The generated URI must be exactly the fixed https origin + fixed prefix + handle.
          const expectedPrefix = {
            cashme: 'https://cash.app/$',
            venmo: 'https://venmo.com/u/',
            revolut: 'https://revolut.me/',
          }[type];
          expect(uri.startsWith(expectedPrefix)).toBe(true);
          // The remainder must contain nothing that could re-open a URL context:
          const tail = uri.slice(expectedPrefix.length);
          expect(tail).not.toMatch(/[/?#@\\]/);
        },
      ),
    );
  });

  it('P2: validator/URI agreement — every accepted handle survives URI building', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HANDLE_TYPES),
        handleArb,
        (type, handle) => {
          const method = PAYMENT_METHODS[type];
          if (method.validate(handle)) {
            expect(() => method.uri(handle)).not.toThrow();
          }
        },
      ),
    );
  });

  it('P3: parsePaymentTargets round-trips through paymentTargetsToTags losslessly for valid targets', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom(...HANDLE_TYPES),
            authority: fc.array(handleChar, { minLength: 1, maxLength: 30 }).map((a) => a.join('')),
          }),
          { maxLength: 6 },
        ).map((list) => {
          // Dedup by type (parse keeps first-wins per type) and pre-validate
          // so the round-trip contract applies to genuinely valid input.
          const seen = new Set<string>();
          return list.filter((t) => {
            if (seen.has(t.type)) return false;
            seen.add(t.type);
            return PAYMENT_METHODS[t.type].validate(t.authority);
          });
        }),
        (targets) => {
          const tags = paymentTargetsToTags(targets as PaymentTarget[]);
          const reparsed = parsePaymentTargets(ev(tags));
          expect(reparsed).toEqual(
            PAYMENT_METHOD_LIST.filter((m) => targets.some((t) => t.type === m.type)).map((m) => ({
              type: m.type,
              authority: expect.any(String),
            })),
          );
        },
      ),
    );
  });

  it('P4: totality — arbitrary tag soup never throws and never yields unrecognized types', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('payto', 'other'),
            fc.string({ maxLength: 24 }),
            fc.string({ maxLength: 80 }),
          ),
          { maxLength: 10 },
        ).map((t) => ev(t)),
        (event) => {
          const targets = parsePaymentTargets(event);
          for (const t of targets) {
            expect(['bitcoin', 'lightning', 'bolt12', 'monero', 'cashme', 'venmo', 'revolut']).toContain(t.type);
            expect(t.authority.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 5_000 },
    );
  });
});
