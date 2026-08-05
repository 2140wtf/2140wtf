import { describe, it, expect } from 'vitest';

import { FUEL_TARGET_MSATS, SWEEP_MIN_MSATS } from './treasury';
import { freshLoopState, step } from './loop';
import type { StrategyMeta } from './strategy';

const strat = (over: Partial<StrategyMeta>): StrategyMeta => ({
  id: 'bounty',
  health: 1,
  expectedMsats: 1000,
  needsFuel: false,
  ...over,
});

describe('step', () => {
  it('sweeps when there are earnings and the tank is not full', () => {
    const { command } = step(freshLoopState(), {
      routstrMsats: 100,
      cashuMsats: SWEEP_MIN_MSATS + 5000,
      nowMs: 0,
      strategies: [strat({})],
    });
    expect(command.kind).toBe('sweep');
  });

  it('earns when starving with nothing to sweep', () => {
    const { command } = step(freshLoopState(), {
      routstrMsats: 0,
      cashuMsats: 0,
      nowMs: 0,
      strategies: [strat({ id: 'bounty', needsFuel: false })],
    });
    expect(command).toEqual({ kind: 'earn', strategy: 'bounty', fuel: 'starving' });
  });

  it('works when fuel is healthy', () => {
    const { command } = step(freshLoopState(), {
      routstrMsats: FUEL_TARGET_MSATS,
      cashuMsats: 0,
      nowMs: 0,
      strategies: [strat({ id: 'bounty' })],
    });
    expect(command).toEqual({ kind: 'work', strategy: 'bounty', fuel: 'healthy' });
  });

  it('idles when no strategy is eligible', () => {
    const { command } = step(freshLoopState(), {
      routstrMsats: FUEL_TARGET_MSATS,
      cashuMsats: 0,
      nowMs: 0,
      strategies: [strat({ id: 'bounty', cooldownUntil: 9999 })],
    });
    expect(command.kind).toBe('idle');
  });

  it('increments iteration and records sweepsRequested on a sweep', () => {
    const s0 = freshLoopState();
    const { state: s1 } = step(s0, {
      routstrMsats: 0,
      cashuMsats: SWEEP_MIN_MSATS,
      nowMs: 0,
      strategies: [strat({})],
    });
    expect(s1.iteration).toBe(1);
    expect(s1.sweepsRequested).toBe(1);
  });

  it('sweep takes precedence over earning even when starving', () => {
    // Starving but the wallet has enough to sweep → top up first, do not earn.
    const { command } = step(freshLoopState(), {
      routstrMsats: 0,
      cashuMsats: SWEEP_MIN_MSATS + 50_000,
      nowMs: 0,
      strategies: [strat({ id: 'bounty', needsFuel: false })],
    });
    expect(command.kind).toBe('sweep');
  });
});
