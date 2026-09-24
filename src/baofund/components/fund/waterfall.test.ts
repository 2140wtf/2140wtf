import { describe, expect, it } from 'vitest';
import { waterfallAllocation } from './waterfall';

const ms = [
  { id: 'm1', title: 'First', amountSats: 100 },
  { id: 'm2', title: 'Second', amountSats: 200 },
  { id: 'm3', title: 'Third', amountSats: 300 },
];

describe('waterfallAllocation - one pot fills milestones in order', () => {
  it('fills the first milestone before touching later ones', () => {
    const rows = waterfallAllocation(ms, 0, 60);
    expect(rows.map((r) => r.addedSats)).toEqual([60, 0, 0]);
    expect(rows[0].complete).toBe(false);
  });

  it('spans milestones when the pledge crosses thresholds', () => {
    const rows = waterfallAllocation(ms, 80, 150); // 80→230 covers m1 + part of m2
    expect(rows.map((r) => r.addedSats)).toEqual([20, 130, 0]);
    expect(rows.map((r) => r.complete)).toEqual([true, false, false]);
    expect(rows[1].afterSats).toBe(130);
  });

  it('funds every milestone when the pledge covers the whole goal', () => {
    const rows = waterfallAllocation(ms, 0, 600);
    expect(rows.map((r) => r.addedSats)).toEqual([100, 200, 300]);
    expect(rows.every((r) => r.complete)).toBe(true);
  });

  it('shows already-funded milestones with zero added sats', () => {
    const rows = waterfallAllocation(ms, 350, 10); // m1 + m2 fully, m3 partial
    expect(rows.map((r) => r.beforeSats)).toEqual([100, 200, 50]);
    expect(rows.map((r) => r.addedSats)).toEqual([0, 0, 10]);
    expect(rows.map((r) => r.complete)).toEqual([true, true, false]);
  });

  it('handles a fully funded campaign and invalid/empty input', () => {
    expect(waterfallAllocation(ms, 1000, 50).map((r) => r.addedSats)).toEqual([0, 0, 0]);
    expect(waterfallAllocation([], 100, 50)).toEqual([]);
    expect(waterfallAllocation(ms, 0, 0).map((r) => r.addedSats)).toEqual([0, 0, 0]);
    expect(waterfallAllocation(ms, -5, -1).map((r) => r.addedSats)).toEqual([0, 0, 0]);
  });
});
