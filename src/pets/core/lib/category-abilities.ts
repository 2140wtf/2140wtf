/**
 * Category abilities — passive gameplay bonuses for each Pets breed category.
 *
 * All values are defined by the Phase B gameplay spec. The functions in this
 * module are pure: they take a category (and optional BAO rarity) and return
 * multipliers / offsets that the decay, item-effect, sats, and reward systems
 * apply at read time.
 */

import type { PetsBreedCategory } from './pet-categories';
import type { BaoRarity } from '@/pets/adult-pets/lib/bao-recipe';
import { BAO_STAT_CAP_BONUS, BAO_REWARD_BONUS } from '@/pets/adult-pets/lib/bao-recipe';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CategoryAbilityBonuses {
  /** Multiplier applied to happiness decay (e.g. 0.85 = 15% slower). */
  happinessDecayMultiplier: number;
  /** Multiplier applied to sats gains from care/daily missions. */
  satsMultiplier: number;
  /** Multiplier applied to daily mission tally progress (e.g. 1.2 = +20%). */
  dailyMissionProgressMultiplier: number;
  /** Multiplier applied to sickness duration from missed care (e.g. 0.7 = -30%). */
  sicknessDurationMultiplier: number;
  /** Extra effective stat cap headroom above the base 100. */
  statCapBonus: number;
  /** Flat BAO reward bonus added to daily BAO claims (only for BAO pets). */
  baoRewardBonus: number;
}

// ─── Daylight helper ───────────────────────────────────────────────────────────

/**
 * Whether the user's local time is currently in daylight hours (06:00–18:00).
 * Used by the NOSTR Pets daylight-netrunning sats bonus.
 */
export function isLocalDaylight(date: Date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 6 && hour < 18;
}

// ─── Ability computation ──────────────────────────────────────────────────────

/**
 * Base bonuses shared by every category before category-specific modifiers.
 */
const BASE_BONUSES: CategoryAbilityBonuses = {
  happinessDecayMultiplier: 1,
  satsMultiplier: 1,
  dailyMissionProgressMultiplier: 1,
  sicknessDurationMultiplier: 1,
  statCapBonus: 0,
  baoRewardBonus: 0,
};

/**
 * Get the passive ability bonuses for a pet category and optional BAO rarity.
 *
 * The returned object is ready to be consumed by decay, item-effect, sats, and
 * reward calculations. Callers should apply each multiplier/offset at the point
 * where the corresponding value is computed.
 *
 * For NOSTR Pets, the daytime sats bonus is included when `isLocalDaylight()`
 * is true. Callers that need the non-daylight value can pass `now` explicitly.
 */
export function getCategoryAbilityBonuses(
  category: PetsBreedCategory | undefined,
  options?: {
    baoRarity?: BaoRarity;
    now?: Date;
  },
): CategoryAbilityBonuses {
  const { baoRarity, now = new Date() } = options ?? {};

  switch (category) {
    case 'ditto-blobbi': {
      return {
        ...BASE_BONUSES,
        happinessDecayMultiplier: 0.85,
        statCapBonus: 5,
      };
    }

    case '2140-pets': {
      const daylightSatsMultiplier = isLocalDaylight(now) ? 1.1 : 1;
      return {
        ...BASE_BONUSES,
        dailyMissionProgressMultiplier: 1.2,
        sicknessDurationMultiplier: 0.7,
        satsMultiplier: daylightSatsMultiplier,
      };
    }

    case 'bao': {
      const rarity = baoRarity ?? 'common';
      return {
        ...BASE_BONUSES,
        statCapBonus: BAO_STAT_CAP_BONUS[rarity],
        baoRewardBonus: BAO_REWARD_BONUS[rarity],
      };
    }

    default:
      return { ...BASE_BONUSES };
  }
}

/**
 * Convenience: effective maximum value for a stat, accounting for category
 * and rarity bonuses. Stored tags are still clamped to 100; this value is
 * used by projection/effect code for temporary over-cap buffers.
 */
export function getEffectiveStatCap(
  category: PetsBreedCategory | undefined,
  baoRarity?: BaoRarity,
): number {
  const bonuses = getCategoryAbilityBonuses(category, { baoRarity });
  return 100 + bonuses.statCapBonus;
}

/**
 * Convenience: flat BAO reward bonus for a rarity tier.
 */
export function getBaoRewardBonus(rarity: BaoRarity | undefined): number {
  if (!rarity) return 0;
  return BAO_REWARD_BONUS[rarity];
}
