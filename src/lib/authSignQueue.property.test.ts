import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AuthSignQueue } from './authSignQueue';

// Deterministic fuzz campaign (round 27c): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260906, numRuns: 200 });

describe('AuthSignQueue — concurrency properties (round 27c)', () => {
  it('P1: no two fires for the same relay are ever concurrent, across randomized schedules', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            relay: fc.constantFrom('rA', 'rB', 'rC'),
            hold: fc.integer({ min: 0, max: 3 }),
            fail: fc.boolean(),
          }),
          { minLength: 1, maxLength: 24 },
        ),
        async (ops) => {
          const q = new AuthSignQueue<number>();
          // Concurrency is tracked PER RELAY: distinct relays are allowed to
          // run in parallel (that's the design) — the invariant is that a
          // single relay never has two fires in flight at once.
          const inFlightByRelay = new Map<string, number>();
          let maxPerRelay = 0;
          type Outcome = { ok: true; v: number } | { ok: false; e: unknown };
          const results: Promise<Outcome>[] = [];
          for (const [i, op] of ops.entries()) {
            const turn: Promise<number> = q.enqueue(
              op.relay,
              async () => {
                const now = (inFlightByRelay.get(op.relay) ?? 0) + 1;
                inFlightByRelay.set(op.relay, now);
                maxPerRelay = Math.max(maxPerRelay, now);
                await new Promise((r) => setTimeout(r, op.hold));
                inFlightByRelay.set(op.relay, (inFlightByRelay.get(op.relay) ?? 1) - 1);
                if (op.fail) throw new Error(`fail-${i}`);
                return i;
              },
            );
            results.push(
              turn.then(
                (v): Outcome => ({ ok: true, v }),
                (e): Outcome => ({ ok: false, e }),
              ),
            );
          }
          const settled = await Promise.all(results);
          // Every turn settled; failures were isolated, not chained.
          expect(settled).toHaveLength(ops.length);
          const failures = settled.filter((s) => !s.ok);
          expect(failures).toHaveLength(ops.filter((o) => o.fail).length);
          // THE invariant: full-turn serialization PER RELAY (cross-relay
          // parallelism is allowed and expected).
          expect(maxPerRelay).toBe(1);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('P2: same-key collapse yields one fire and identical results for all callers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 3 }),
        async (callers, hold) => {
          const q = new AuthSignQueue<number>();
          let fires = 0;
          const key = 'relay\nchallenge-x';
          const fire = () =>
            q.collapse(key, async () => {
              fires += 1;
              await new Promise((r) => setTimeout(r, hold));
              return 7;
            });
          const all = Array.from({ length: callers }, () => fire());
          const values = await Promise.all(all);
          expect(fires).toBe(1);
          for (const v of values) expect(v).toBe(7);
        },
      ),
    );
  });
});
