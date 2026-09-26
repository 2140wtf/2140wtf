import { describe, it, expect } from 'vitest';
import { quorumTime, floorToSecond, isLocktimeReached, type ClockSample, VirtualClock } from './baoClock';

const clk = (id: string, t: number, skew = 0): ClockSample => ({ id, time: t + skew });

describe('quorumTime (spec §3: median of 3, fail-closed)', () => {
  it('returns the median of three clocks', () => {
    const r = quorumTime([clk('a', 1000), clk('b', 1010), clk('c', 1020)], 30);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.time).toBe(1010);
  });

  it('is order-independent', () => {
    const a = quorumTime([clk('c', 1020), clk('a', 1000), clk('b', 1010)], 30);
    const b = quorumTime([clk('b', 1010), clk('c', 1020), clk('a', 1000)], 30);
    expect(a).toEqual(b);
  });

  it('drops an outlier but reports it when within tolerance', () => {
    // 1000, 1010, 2000 → median 1010, spread vs outlier = 990 > 30 tolerance,
    // but quorum of 2 agreeing clocks still succeeds.
    const r = quorumTime([clk('a', 1000), clk('b', 1010), clk('c', 2000)], 30);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.time).toBe(1010);
      expect(r.agreeing).toEqual(['a', 'b']);
    }
  });

  it('fails closed when no pair of clocks agrees within tolerance', () => {
    const r = quorumTime([clk('a', 1000), clk('b', 1100), clk('c', 1200)], 30);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('quorum_time_disagreement');
      expect(r.detail.clocks).toHaveLength(3);
      expect(r.retryable).toBe(true);
    }
  });

  it('requires at least 3 samples (2-clock quorum is gameable)', () => {
    expect(quorumTime([clk('a', 1000), clk('b', 1000)], 30).ok).toBe(false);
    expect(quorumTime([], 30).ok).toBe(false);
  });

  it('tolerance is inclusive at the boundary', () => {
    const r = quorumTime([clk('a', 1000), clk('b', 1030), clk('c', 1015)], 30);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.time).toBe(1015);
  });
});

describe('floorToSecond (spec §3: locktimes truncate, never round up)', () => {
  it('floors fractional seconds', () => {
    expect(floorToSecond(1700000000.999)).toBe(1700000000);
    expect(floorToSecond(1700000000)).toBe(1700000000);
  });
});

describe('isLocktimeReached (locktimes are one-sided: only unlock)', () => {
  it('is false strictly before, true at, the locktime', () => {
    expect(isLocktimeReached(1700000000, 1699999999)).toBe(false);
    expect(isLocktimeReached(1700000000, 1700000000)).toBe(true);
    expect(isLocktimeReached(1700000000, 1700000001)).toBe(true);
  });

  it('quorum failure fails closed - a refund attempt cannot bypass a locktime via clock disagreement', () => {
    // Fail-closed quorum => quorumTime undefined => locktime NOT reached,
    // even past the wall clock. (Refunds via mint-side NUT-11 locktime are
    // unaffected - this is the client-side gate only.)
    expect(isLocktimeReached(1700000000, undefined)).toBe(false);
  });
});


describe('clock input validation and limits (R08)', () => {
  it('does not count duplicate identities as independent clocks', () => {
    const result = quorumTime([clk('same', 100), clk('same', 100), clk('same', 100)], 1);
    expect(result).toMatchObject({ ok: false, retryAfter: 1, detail: { reason: 'duplicate_source' } });
  });
  it.each([NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1])('fails closed on invalid sample or tolerance %s', value => {
    expect(quorumTime([clk('a', value), clk('b', 100), clk('c', 100)], 1).ok).toBe(false);
    expect(quorumTime([clk('a', 100), clk('b', 100), clk('c', 100)], value).ok).toBe(false);
    expect(isLocktimeReached(100, value)).toBe(false);
    expect(isLocktimeReached(value, 100)).toBe(false);
    expect(() => floorToSecond(value)).toThrow(TypeError);
  });
  it('returns JSON-stable error details for empty and malformed inputs', () => {
    for (const values of [[], [clk('a', NaN)], [null], Array(3)]) {
      const result = quorumTime(values as ClockSample[], 1);
      expect(result.ok).toBe(false);
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  });
  it.each(['', ' ', ' a'])('rejects ambiguous source id %s', id => {
    expect(quorumTime([clk(id, 1), clk('b', 1), clk('c', 1)], 0).ok).toBe(false);
  });
  it('uses the midpoint for an even quorum without arithmetic overflow', () => {
    expect(quorumTime([clk('a', 10), clk('b', 11), clk('c', 12), clk('d', 13)], 2)).toMatchObject({ ok: true, time: 11.5 });
  });
  it('shows that two correlated skewed sources can bias the majority', () => {
    const result = quorumTime([clk('honest', 100), clk('skewed-a', 100, 60), clk('skewed-b', 100, 60)], 1);
    expect(result).toEqual({ ok: true, time: 160, agreeing: ['skewed-a', 'skewed-b'] });
    // Source independence must be configured externally; the math cannot attest it.
  });
  it('crosses locktime boundaries with a controllable fractional-seconds clock', () => {
    const clock = new VirtualClock(99.999);
    expect(isLocktimeReached(100, clock.nowSeconds())).toBe(false);
    clock.advanceSeconds(0.001);
    expect(isLocktimeReached(100, clock.nowSeconds())).toBe(true);
    clock.setSeconds(98);
    expect(isLocktimeReached(100, clock.nowSeconds())).toBe(false);
    expect(() => clock.advanceSeconds(-1)).toThrow(TypeError);
    expect(clock.nowSeconds()).toBe(98);
  });
});
