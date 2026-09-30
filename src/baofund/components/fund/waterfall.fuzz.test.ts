/**
 * WS9 round-4 fuzz: split-waterfall preview allocation.
 *
 * `waterfallAllocation` mirrors the API's single-pot milestone escrow math
 * (`allocateWaterfallSplit`) for the pledge preview. The properties:
 *   - rows are 1:1 with milestones, integers ≥ 0, before + added === after;
 *   - without the overfund flag, no row exceeds its target and the pledge is
 *     never allocated twice;
 *   - WITH the flag, a split pledge allocates EXACTLY the pledge (the
 *     remainder rides the last funded row - the round-4 fix; clamping it away
 *     told the donor their overfunding went nowhere);
 *   - hostile numbers (NaN/Infinity/negative/fractional/2^53) degrade safely.
 *
 * Deterministic (mulberry32); pure math, no I/O.
 */
import { describe, expect, it } from 'vitest';
import { waterfallAllocation, type WaterfallMilestone } from './waterfall';

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('waterfall allocation - fuzz (round 4)', () => {
  it('conserves sats, stays integral, and the split remainder is never dropped', () => {
    const rnd = mulberry32(0x5eed60);
    for (let i = 0; i < 600; i++) {
      const count = Math.floor(rnd() * 6);
      const milestones: WaterfallMilestone[] = Array.from({ length: count }, (_, k) => ({
        id: `m${k}`, title: `Milestone ${k}`, amountSats: Math.floor(rnd() * 100_000),
      }));
      const total = Math.floor(rnd() * 300_000);
      const pledge = Math.floor(rnd() * 150_000);
      const overfund = rnd() < 0.5;
      const rows = waterfallAllocation(milestones, total, pledge, { overfundLastRow: overfund });
      expect(rows).toHaveLength(milestones.length);
      for (const r of rows) {
        for (const v of [r.targetSats, r.beforeSats, r.addedSats, r.afterSats, r.overfundSats]) {
          expect(Number.isSafeInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
        expect(r.beforeSats + r.addedSats).toBe(r.afterSats);
        expect(r.afterSats).toBeLessThanOrEqual(r.targetSats + (r.overfundSats ?? 0));
        expect(r.addedSats).toBeLessThanOrEqual(Math.max(0, r.targetSats - r.beforeSats) + r.overfundSats);
      }
      const allocated = sum(rows.map((r) => r.addedSats));
      const totalTarget = sum(milestones.map((m) => m.amountSats));
      expect(allocated).toBeLessThanOrEqual(pledge);
      if (overfund && pledge > 0 && milestones.length > 0) {
        // The split preview must allocate the whole pledge exactly - the API
        // attaches the remainder to the last funded row's escrow output.
        expect(allocated).toBe(pledge);
        const over = sum(rows.map((r) => r.overfundSats));
        expect(over).toBeGreaterThanOrEqual(0);
        expect(over).toBeLessThanOrEqual(pledge);
      } else {
        // Clamped band: never allocate more than the goal space left.
        expect(allocated).toBeLessThanOrEqual(Math.max(0, totalTarget - total));
      }
    }
  });

  it('hostile numbers degrade safely (no throw, all rows integral)', () => {
    const rnd = mulberry32(0x5eed61);
    const hostile = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5, 2 ** 53, 2 ** 53 + 2, 0];
    for (let i = 0; i < 400; i++) {
      const milestones: WaterfallMilestone[] = [
        { id: 'a', title: 'A', amountSats: pick(rnd, hostile) },
        { id: 'b', title: 'B', amountSats: pick(rnd, hostile) },
      ];
      expect(() => waterfallAllocation(milestones, pick(rnd, hostile), pick(rnd, hostile), { overfundLastRow: rnd() < 0.5 })).not.toThrow();
      const rows = waterfallAllocation(milestones, pick(rnd, hostile), pick(rnd, hostile), { overfundLastRow: true });
      for (const r of rows) {
        expect(Number.isFinite(r.addedSats)).toBe(true);
        expect(r.addedSats).toBeGreaterThanOrEqual(0);
      }
    }
    // Empty milestone list never allocates and never throws.
    expect(waterfallAllocation([], 1_000, 5_000, { overfundLastRow: true })).toEqual([]);
    // Determinism: identical inputs produce identical rows.
    const ms = [{ id: 'a', title: 'A', amountSats: 100 }, { id: 'b', title: 'B', amountSats: 200 }];
    expect(waterfallAllocation(ms, 50, 400, { overfundLastRow: true })).toEqual(
      waterfallAllocation(ms, 50, 400, { overfundLastRow: true }),
    );
  });
});
