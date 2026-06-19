/**
 * Daily Login Bonus for 2140 PETS
 *
 * Awards coins the first time a user opens the Pets page each local day.
 * Tracks last login day and consecutive streak on the Blobbonaut profile.
 */

import { getLocalDayString, getDaysDifference } from '@/pets/core/lib/pets';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Base coins awarded for logging in each day */
export const DAILY_LOGIN_BASE_COINS = 50;

/** Additional coins awarded per day of consecutive login streak */
export const DAILY_LOGIN_STREAK_BONUS_COINS = 10;

/** Maximum total streak bonus per login */
export const MAX_DAILY_LOGIN_STREAK_BONUS_COINS = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DailyLoginBonusResult {
  /** Whether a bonus was awarded */
  awarded: boolean;
  /** Coins awarded this login (0 if already claimed today) */
  coinsAwarded: number;
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
    return { awarded: false, coinsAwarded: 0, streak: currentStreak, lastDay: today };
  }

  const isConsecutive = lastDay ? getDaysDifference(lastDay, today) === 1 : false;
  const streak = isConsecutive ? currentStreak + 1 : 1;
  const streakBonus = Math.min(
    (streak - 1) * DAILY_LOGIN_STREAK_BONUS_COINS,
    MAX_DAILY_LOGIN_STREAK_BONUS_COINS,
  );
  const coinsAwarded = DAILY_LOGIN_BASE_COINS + streakBonus;

  return { awarded: true, coinsAwarded, streak, lastDay: today };
}
