import { describe, it, expect } from 'vitest';

import { selectStrategy, type StrategyMeta } from './strategy';

const base = (over: Partial<StrategyMeta>): StrategyMeta => ({
  id: 'bounty',
  health: 0.5,
  expectedMsats: 1000,
  needsFuel: false,
  ...over,
});

describe('selectStrategy', () => {
  it('idles when every strategy is on cooldown', () => {
    const d = selectStrategy({
      nowMs: 100,
      fuel: 'healthy',
      strategies: [base({ id: 'bounty', cooldownUntil: 200 })],
    });
    expect(d).toEqual({ kind: 'idle', reason: 'all strategies on cooldown' });
  });

  it('when starving, prefers a no-fuel strategy over a higher-yield fuel one', () => {
    const d = selectStrategy({
      nowMs: 0,
      fuel: 'starving',
      strategies: [
        base({ id: 'trader', expectedMsats: 1_000_000, needsFuel: true }),
        base({ id: 'bounty', expectedMsats: 1000, needsFuel: false }),
      ],
    });
    expect(d).toEqual({ kind: 'run', strategy: 'bounty' });
  });

  it('when starving and everything needs fuel, falls back to highest yield', () => {
    const d = selectStrategy({
      nowMs: 0,
      fuel: 'starving',
      strategies: [
        base({ id: 'zap', expectedMsats: 500, needsFuel: true }),
        base({ id: 'trader', expectedMsats: 9_000, needsFuel: true }),
      ],
    });
    expect(d).toEqual({ kind: 'run', strategy: 'trader' });
  });

  it('when healthy, maximises expected value (yield × health)', () => {
    const d = selectStrategy({
      nowMs: 0,
      fuel: 'healthy',
      strategies: [
        base({ id: 'bounty', expectedMsats: 10_000, health: 0.1 }), // ev 1000
        base({ id: 'zap', expectedMsats: 5_000, health: 0.5 }), // ev 2500
        base({ id: 'trader', expectedMsats: 8_000, health: 0.2 }), // ev 1600
      ],
    });
    expect(d).toEqual({ kind: 'run', strategy: 'zap' });
  });

  it('excludes cooldown strategies but still picks among the rest', () => {
    const d = selectStrategy({
      nowMs: 100,
      fuel: 'healthy',
      strategies: [
        base({ id: 'bounty', expectedMsats: 100_000, health: 1, cooldownUntil: 200 }),
        base({ id: 'zap', expectedMsats: 10_000, health: 1 }),
      ],
    });
    expect(d).toEqual({ kind: 'run', strategy: 'zap' });
  });
});
