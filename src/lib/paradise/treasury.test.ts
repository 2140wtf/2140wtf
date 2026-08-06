import { describe, it, expect } from 'vitest';

import {
  FUEL_RESERVE_MSATS,
  FUEL_TARGET_MSATS,
  SWEEP_MIN_MSATS,
  classifyFuel,
  planSweep,
} from './treasury';

describe('classifyFuel', () => {
  it('is starving below the reserve', () => {
    expect(classifyFuel(0)).toBe('starving');
    expect(classifyFuel(FUEL_RESERVE_MSATS - 1)).toBe('starving');
  });

  it('is low between the reserve and the target', () => {
    expect(classifyFuel(FUEL_RESERVE_MSATS)).toBe('low');
    expect(classifyFuel(FUEL_TARGET_MSATS - 1)).toBe('low');
  });

  it('is healthy at or above the target', () => {
    expect(classifyFuel(FUEL_TARGET_MSATS)).toBe('healthy');
    expect(classifyFuel(FUEL_TARGET_MSATS * 10)).toBe('healthy');
  });
});

describe('planSweep', () => {
  it('returns null when the wallet is below the dust floor', () => {
    expect(planSweep({ routstrMsats: 0, cashuMsats: SWEEP_MIN_MSATS - 1 })).toBeNull();
  });

  it('returns null when the tank is already healthy', () => {
    expect(planSweep({ routstrMsats: FUEL_TARGET_MSATS, cashuMsats: 1_000_000 })).toBeNull();
  });

  it('tops the tank up to the target without draining the wallet below zero', () => {
    const plan = planSweep({ routstrMsats: 100_000, cashuMsats: 5_000_000 });
    expect(plan).not.toBeNull();
    expect(plan!.amountMsats).toBe(FUEL_TARGET_MSATS - 100_000);
    expect(plan!.leavesCashuMsats).toBe(5_000_000 - (FUEL_TARGET_MSATS - 100_000));
    expect(plan!.projectedFuel).toBe('healthy');
  });

  it('sweeps only what the wallet holds when the deficit exceeds the balance', () => {
    // 15_000 msats clears the dust floor (10_000) but is below the reserve
    // (21_000), so after the sweep the tank is still starving.
    const plan = planSweep({ routstrMsats: 0, cashuMsats: 15_000 });
    expect(plan).not.toBeNull();
    expect(plan!.amountMsats).toBe(15_000);
    expect(plan!.leavesCashuMsats).toBe(0);
    expect(plan!.projectedFuel).toBe('starving');
  });
});
