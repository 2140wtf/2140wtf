import type { BaoTradeActivity } from './bao-trade-parser';

/**
 * Conversion rate from signet sats (or future Cashu sats) to pet BAO sats.
 *
 * 1 sat of BAO trading activity = 1 pet BAO sat, up to the daily cap. The cap
 * exists to keep the pet economy stable while BAO is still on signet/demo.
 */
export const BAO_SAT_TO_BAO_RATE = 1;

/** Maximum BAO sats that can be earned from trading activity per day. */
export const BAO_DAILY_REWARD_CAP = 50_000;

/** Minimum total active order amount required before any reward is granted. */
export const BAO_MIN_ACTIVE_AMOUNT = 1_000;

/** Trader tier thresholds in lifetime BAO earned. */
export const BAO_TIER_THRESHOLDS = [0, 1_000, 5_000, 25_000, 100_000] as const;

/** Human-readable labels for each trader tier. */
export const BAO_TIER_LABELS = [
  'Newcomer',
  'Bronze Trader',
  'Silver Trader',
  'Gold Trader',
  'Platinum Trader',
] as const;

/**
 * Calculate the trader tier index from lifetime BAO earned.
 */
export function calculateBaoTier(lifetimeBao: number): number {
  let tier = 0;
  for (let i = 0; i < BAO_TIER_THRESHOLDS.length; i++) {
    if (lifetimeBao >= BAO_TIER_THRESHOLDS[i]) {
      tier = i;
    }
  }
  return tier;
}

/**
 * Get the human-readable label for a trader tier index.
 */
export function getBaoTierLabel(tier: number): string {
  return BAO_TIER_LABELS[Math.max(0, Math.min(tier, BAO_TIER_LABELS.length - 1))];
}

/**
 * Result of a BAO reward calculation.
 */
export interface BaoRewardResult {
  /** Whether the reward can be claimed today */
  claimable: boolean;
  /** Sats that would be awarded */
  sats: number;
  /** Total active order amount used for the calculation */
  activeAmount: number;
  /** Current trader tier index */
  tier: number;
  /** Current trader tier label */
  tierLabel: string;
}

/**
 * Calculate today's BAO reward from BAO trading activity.
 *
 * Returns 0 sats if the user has already claimed today or if their active
 * order amount is below the minimum threshold.
 */
export function calculateBaoReward(
  activity: BaoTradeActivity,
  lifetimeBao: number,
  claimedDate: string | undefined,
  today: string,
): BaoRewardResult {
  const tier = calculateBaoTier(lifetimeBao);
  const activeAmount = activity.totalActiveAmount;

  if (claimedDate === today || activeAmount < BAO_MIN_ACTIVE_AMOUNT) {
    return {
      claimable: false,
      sats: 0,
      activeAmount,
      tier,
      tierLabel: getBaoTierLabel(tier),
    };
  }

  const rawReward = Math.floor(activeAmount * BAO_SAT_TO_BAO_RATE);
  const sats = Math.min(rawReward, BAO_DAILY_REWARD_CAP);

  return {
    claimable: true,
    sats,
    activeAmount,
    tier,
    tierLabel: getBaoTierLabel(tier),
  };
}
