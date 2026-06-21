import { describe, it, expect } from 'vitest';

import {
  calculateActionReward,
  calculateInventoryActionReward,
  applySatsReward,
  getSatsRewardSummary,
  formatSatsGain,
  getSatsGainMessage,
  ACTION_REWARDS,
  INVENTORY_ACTION_REWARDS,
  DIRECT_ACTION_REWARDS,
  POOP_CLEANUP_REWARD,
} from './pets-action-rewards';

describe('calculateActionReward', () => {
  it('returns the correct sats reward for each inventory action', () => {
    expect(calculateActionReward('feed')).toBe(5);
    expect(calculateActionReward('play')).toBe(8);
    expect(calculateActionReward('clean')).toBe(6);
    expect(calculateActionReward('medicine')).toBe(10);
    expect(calculateActionReward('boost')).toBe(7);
  });

  it('returns the correct sats reward for each direct action', () => {
    expect(calculateActionReward('play_music')).toBe(7);
    expect(calculateActionReward('sing')).toBe(9);
  });

  it('returns 0 for unknown actions', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(calculateActionReward('unknown' as any)).toBe(0);
  });
});

describe('calculateInventoryActionReward', () => {
  it('returns base sats for quantity 1', () => {
    expect(calculateInventoryActionReward('feed', 1)).toBe(5);
    expect(calculateInventoryActionReward('medicine', 1)).toBe(10);
  });

  it('multiplies sats by quantity', () => {
    expect(calculateInventoryActionReward('feed', 3)).toBe(15);
    expect(calculateInventoryActionReward('play', 5)).toBe(40);
  });

  it('defaults to quantity 1', () => {
    expect(calculateInventoryActionReward('clean')).toBe(6);
  });

  it('returns 0 for zero or negative quantity', () => {
    expect(calculateInventoryActionReward('feed', 0)).toBe(0);
    expect(calculateInventoryActionReward('feed', -1)).toBe(0);
  });
});

describe('applySatsReward', () => {
  it('adds sats to a current balance', () => {
    expect(applySatsReward(100, 25)).toBe(125);
  });

  it('treats undefined current balance as 0', () => {
    expect(applySatsReward(undefined, 10)).toBe(10);
  });

  it('never goes below zero', () => {
    expect(applySatsReward(5, -20)).toBe(0);
    expect(applySatsReward(0, -1)).toBe(0);
  });

  it('handles zero reward', () => {
    expect(applySatsReward(50, 0)).toBe(50);
  });
});

describe('getSatsRewardSummary', () => {
  it('returns sats gained and quantity', () => {
    expect(getSatsRewardSummary('feed', 3)).toEqual({ satsGained: 15, quantity: 3 });
    expect(getSatsRewardSummary('sing')).toEqual({ satsGained: 9, quantity: 1 });
  });
});

describe('formatSatsGain', () => {
  it('formats positive sats as "+N sats"', () => {
    expect(formatSatsGain(15)).toBe('+15 sats');
    expect(formatSatsGain(1)).toBe('+1 sats');
  });

  it('returns empty string for zero or negative sats', () => {
    expect(formatSatsGain(0)).toBe('');
    expect(formatSatsGain(-5)).toBe('');
  });
});

describe('getSatsGainMessage', () => {
  it('formats a message with action and sats earned', () => {
    expect(getSatsGainMessage('feed', 5)).toBe('+5 sats earned!');
  });

  it('includes total when provided', () => {
    expect(getSatsGainMessage('feed', 5, 105)).toBe('+5 sats earned! Total: 105 sats');
  });

  it('returns empty string for zero or negative sats', () => {
    expect(getSatsGainMessage('feed', 0)).toBe('');
    expect(getSatsGainMessage('feed', -1)).toBe('');
  });
});

describe('reward constants', () => {
  it('ACTION_REWARDS contains all inventory and direct actions', () => {
    for (const action of Object.keys(INVENTORY_ACTION_REWARDS)) {
      expect(ACTION_REWARDS).toHaveProperty(action);
      expect(ACTION_REWARDS[action as keyof typeof ACTION_REWARDS]).toBe(
        INVENTORY_ACTION_REWARDS[action as keyof typeof INVENTORY_ACTION_REWARDS],
      );
    }

    for (const action of Object.keys(DIRECT_ACTION_REWARDS)) {
      expect(ACTION_REWARDS).toHaveProperty(action);
      expect(ACTION_REWARDS[action as keyof typeof ACTION_REWARDS]).toBe(
        DIRECT_ACTION_REWARDS[action as keyof typeof DIRECT_ACTION_REWARDS],
      );
    }
  });

  it('all reward values are positive integers', () => {
    for (const value of Object.values(ACTION_REWARDS)) {
      expect(value).toBeGreaterThan(0);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('poop cleanup reward is positive', () => {
    expect(POOP_CLEANUP_REWARD).toBeGreaterThan(0);
    expect(Number.isInteger(POOP_CLEANUP_REWARD)).toBe(true);
  });
});
