import { describe, it, expect } from 'vitest';

import {
  getCategoryAbilityBonuses,
  getEffectiveStatCap,
  getBaoRewardBonus,
  isLocalDaylight,
} from './category-abilities';
import type { PetsBreedCategory } from './pet-categories';
import { BAO_REWARD_BONUS, BAO_STAT_CAP_BONUS } from '@/pets/adult-pets/lib/bao-recipe';

// ─── isLocalDaylight ───────────────────────────────────────────────────────────

describe('isLocalDaylight', () => {
  it('returns true at 06:00', () => {
    expect(isLocalDaylight(new Date('2026-01-01T06:00:00'))).toBe(true);
  });

  it('returns true at 12:00', () => {
    expect(isLocalDaylight(new Date('2026-01-01T12:00:00'))).toBe(true);
  });

  it('returns true at 17:59', () => {
    expect(isLocalDaylight(new Date('2026-01-01T17:59:00'))).toBe(true);
  });

  it('returns false at 18:00', () => {
    expect(isLocalDaylight(new Date('2026-01-01T18:00:00'))).toBe(false);
  });

  it('returns false at 05:59', () => {
    expect(isLocalDaylight(new Date('2026-01-01T05:59:00'))).toBe(false);
  });

  it('returns false at midnight', () => {
    expect(isLocalDaylight(new Date('2026-01-01T00:00:00'))).toBe(false);
  });
});

// ─── getCategoryAbilityBonuses ─────────────────────────────────────────────────

describe('getCategoryAbilityBonuses', () => {
  it('returns base bonuses for unknown category', () => {
    const bonuses = getCategoryAbilityBonuses(undefined);
    expect(bonuses).toEqual({
      happinessDecayMultiplier: 1,
      satsMultiplier: 1,
      dailyMissionProgressMultiplier: 1,
      sicknessDurationMultiplier: 1,
      statCapBonus: 0,
      baoRewardBonus: 0,
    });
  });

  it('returns base bonuses for unrecognized category value', () => {
    const bonuses = getCategoryAbilityBonuses('unknown' as PetsBreedCategory);
    expect(bonuses.happinessDecayMultiplier).toBe(1);
    expect(bonuses.statCapBonus).toBe(0);
  });

  describe('blobbi', () => {
    it('has slower happiness decay and higher stat cap', () => {
      const bonuses = getCategoryAbilityBonuses('ditto-blobbi');
      expect(bonuses.happinessDecayMultiplier).toBe(0.85);
      expect(bonuses.statCapBonus).toBe(5);
    });

    it('does not apply a daylight sats bonus', () => {
      const noon = new Date('2026-06-20T12:00:00');
      const bonuses = getCategoryAbilityBonuses('ditto-blobbi', { now: noon });
      expect(bonuses.satsMultiplier).toBe(1);
    });
  });

  describe('2140-pets', () => {
    it('boosts daily mission progress and shortens sickness', () => {
      const bonuses = getCategoryAbilityBonuses('2140-pets');
      expect(bonuses.dailyMissionProgressMultiplier).toBe(1.2);
      expect(bonuses.sicknessDurationMultiplier).toBe(0.7);
    });

    it('gains a daylight sats bonus during daylight', () => {
      const noon = new Date('2026-06-20T12:00:00');
      const bonuses = getCategoryAbilityBonuses('2140-pets', { now: noon });
      expect(bonuses.satsMultiplier).toBe(1.1);
    });

    it('does not gain a daylight sats bonus at night', () => {
      const midnight = new Date('2026-06-20T00:00:00');
      const bonuses = getCategoryAbilityBonuses('2140-pets', { now: midnight });
      expect(bonuses.satsMultiplier).toBe(1);
    });
  });

  describe('bao', () => {
    it('defaults to common rarity when none provided', () => {
      const bonuses = getCategoryAbilityBonuses('bao');
      expect(bonuses.statCapBonus).toBe(BAO_STAT_CAP_BONUS.common);
      expect(bonuses.baoRewardBonus).toBe(BAO_REWARD_BONUS.common);
    });

    it.each([
      ['common', 1_000],
      ['uncommon', 1_800],
      ['rare', 2_800],
      ['epic', 4_000],
      ['legendary', 5_000],
    ] as const)('bao %s reward bonus is %i', (rarity, expected) => {
      const bonuses = getCategoryAbilityBonuses('bao', { baoRarity: rarity });
      expect(bonuses.baoRewardBonus).toBe(expected);
    });

    it.each([
      ['common', 100],
      ['uncommon', 105],
      ['rare', 112],
      ['epic', 120],
      ['legendary', 130],
    ] as const)('bao %s effective stat cap is %i', (rarity, expected) => {
      const bonuses = getCategoryAbilityBonuses('bao', { baoRarity: rarity });
      expect(100 + bonuses.statCapBonus).toBe(expected);
    });
  });
});

// ─── getEffectiveStatCap ───────────────────────────────────────────────────────

describe('getEffectiveStatCap', () => {
  it('is 100 for unknown category', () => {
    expect(getEffectiveStatCap(undefined)).toBe(100);
  });

  it('is 105 for blobbi', () => {
    expect(getEffectiveStatCap('ditto-blobbi')).toBe(105);
  });

  it('is 100 for 2140-pets', () => {
    expect(getEffectiveStatCap('2140-pets')).toBe(100);
  });

  it.each([
    ['common', 100],
    ['uncommon', 105],
    ['rare', 112],
    ['epic', 120],
    ['legendary', 130],
  ] as const)('is %i for bao %s', (rarity, expected) => {
    expect(getEffectiveStatCap('bao', rarity)).toBe(expected);
  });
});

// ─── getBaoRewardBonus ─────────────────────────────────────────────────────────

describe('getBaoRewardBonus', () => {
  it('returns 0 for undefined rarity', () => {
    expect(getBaoRewardBonus(undefined)).toBe(0);
  });

  it.each([
    ['common', 1_000],
    ['uncommon', 1_800],
    ['rare', 2_800],
    ['epic', 4_000],
    ['legendary', 5_000],
  ] as const)('returns %i for %s', (rarity, expected) => {
    expect(getBaoRewardBonus(rarity)).toBe(expected);
  });
});
