/**
 * Daily Login Bonus for NOSTR PETS
 *
 * Awards demo sats the first time a user opens the Pets page each local day.
 * Tracks last login day and consecutive streak on the Nostr pet profile.
 */

import { getLocalDayString, getDaysDifference } from '@/pets/core/lib/pets';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Demo sats awarded per legacy coin (keeps old economy values readable). */
export const DEMO_SATS_PER_COIN = 100;

/** Base sats awarded for logging in each day */
export const DAILY_LOGIN_BASE_SATS = 50 * DEMO_SATS_PER_COIN;

/** Additional sats awarded per day of consecutive login streak */
export const DAILY_LOGIN_STREAK_BONUS_SATS = 10 * DEMO_SATS_PER_COIN;

/** Maximum total streak bonus per login */
export const MAX_DAILY_LOGIN_STREAK_BONUS_SATS = 100 * DEMO_SATS_PER_COIN;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DailyLoginBonusResult {
  /** Whether a bonus was awarded */
  awarded: boolean;
  /** Sats awarded this login (0 if already claimed today) */
  satsAwarded: number;
  /** New streak length */
  streak: number;
  /** Last login day that will be written to the profile */
  lastDay: string;
}

// ─── Calculation ──────────────────────────────────────────────────────────────

/**
 * Calculate today's login bonus given the persisted last-day and streak.
 *
 * - Same day: no bonus (already claimed).
 * - Next consecutive day: streak +1.
 * - Any other gap (or no prior day): streak resets to 1.
 */
export function calculateDailyLoginBonus(
  lastDay: string | undefined,
  currentStreak: number,
  today = getLocalDayString(),
): DailyLoginBonusResult {
  if (lastDay === today) {
    return { awarded: false, satsAwarded: 0, streak: currentStreak, lastDay: today };
  }

  const isConsecutive = lastDay ? getDaysDifference(lastDay, today) === 1 : false;
  const streak = isConsecutive ? currentStreak + 1 : 1;
  const streakBonus = Math.min(
    (streak - 1) * DAILY_LOGIN_STREAK_BONUS_SATS,
    MAX_DAILY_LOGIN_STREAK_BONUS_SATS,
  );
  const satsAwarded = DAILY_LOGIN_BASE_SATS + streakBonus;

  return { awarded: true, satsAwarded, streak, lastDay: today };
}
