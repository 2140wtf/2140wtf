import { describe, expect, it } from 'vitest';
import {
  countLeadingZeroBits,
  grindLocalPow,
  loadPassed,
  powAttemptBudget,
  savePassed,
  AGENT_GATE_DIFFICULTY,
} from './AgentGateCheck';

describe('powAttemptBudget', () => {
  it('is 16x the expected work (2^difficulty)', () => {
    expect(powAttemptBudget(0)).toBe(16);
    expect(powAttemptBudget(8)).toBe(16 * 256);
    expect(powAttemptBudget(20)).toBe(16 * 2 ** 20);
  });
});

describe('countLeadingZeroBits', () => {
  it('counts leading zero bits on a hex string', () => {
    // '00ff…' → 8 leading zeros; '0f…' → 4; 'ff…' → 0.
    expect(countLeadingZeroBits('00ff')).toBe(8);
    expect(countLeadingZeroBits('0fff')).toBe(4);
    expect(countLeadingZeroBits('ffff')).toBe(0);
    expect(countLeadingZeroBits('00000fff')).toBe(20);
  });

  it('handles a nibble split (0 in high bits of the nibble)', () => {
    // '08' = 0b00001000 → 4 leading zeros
    expect(countLeadingZeroBits('08')).toBe(4);
    // '01' = 0b00000001 → 7 leading zeros
    expect(countLeadingZeroBits('01')).toBe(7);
  });
});

describe('grindLocalPow', () => {
  it('finds a commitment meeting difficulty 8 quickly', () => {
    const id = grindLocalPow('a'.repeat(64), Date.now(), 8);
    expect(countLeadingZeroBits(id)).toBeGreaterThanOrEqual(8);
  });

  it('produces a 64-hex event id', () => {
    const id = grindLocalPow('b'.repeat(64), Date.now(), 4);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws when the attempt budget is exhausted (impossible difficulty)', () => {
    // Difficulty 256 is refused outright (out of the 0–64 sanity range) - the
    // grind must abort rather than spin forever.
    expect(() => grindLocalPow('c'.repeat(64), Date.now(), 256)).toThrow(/out of range/);
  });

  it('refuses out-of-range difficulties instead of looping forever', () => {
    expect(powAttemptBudget(-1)).toBe(0);
    expect(powAttemptBudget(41)).toBe(0);
    expect(powAttemptBudget(65)).toBe(0);
    expect(powAttemptBudget(40)).toBeGreaterThan(0);
  });

  it('default difficulty is sane for UI friction (<= 24)', () => {
    expect(AGENT_GATE_DIFFICULTY).toBeLessThanOrEqual(24);
  });
});

describe('pass persistence', () => {
  it('round-trips through localStorage', () => {
    const pk = 'd'.repeat(64);
    expect(loadPassed(pk)).toBe(false);
    savePassed(pk);
    expect(loadPassed(pk)).toBe(true);
  });

  it('is scoped per pubkey', () => {
    const a = 'e'.repeat(64);
    const b = 'f'.repeat(64);
    savePassed(a);
    expect(loadPassed(a)).toBe(true);
    expect(loadPassed(b)).toBe(false);
  });
});
