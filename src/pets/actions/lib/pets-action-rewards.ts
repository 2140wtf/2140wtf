/**
 * Pets Action Reward System
 *
 * Defines the small sats reward for care actions and provides utilities for
 * calculating and formatting those rewards. This replaced the old XP layer
 * after the economy moved to a sats-only model.
 */

import type { PetsAction, InventoryAction, DirectAction } from './pets-action-utils';

// ─── Sats Rewards by Action ───────────────────────────────────────────────────

/**
 * Base sats reward for item-based care actions (feed, play, clean, medicine, boost).
 */
export const INVENTORY_ACTION_REWARDS: Record<InventoryAction, number> = {
  feed: 5,
  play: 8,
  clean: 6,
  medicine: 10,
  boost: 7,
};

/**
 * Base sats reward for direct actions (play_music, sing).
 */
export const DIRECT_ACTION_REWARDS: Record<DirectAction, number> = {
  play_music: 7,
  sing: 9,
};

/**
 * Combined sats reward lookup for all action types.
 */
export const ACTION_REWARDS: Record<PetsAction, number> = {
  ...INVENTORY_ACTION_REWARDS,
  ...DIRECT_ACTION_REWARDS,
};

/**
 * Sats reward for cleaning up a single poop.
 */
export const POOP_CLEANUP_REWARD = 5;

// ─── Calculation Utilities ────────────────────────────────────────────────────

/**
 * Calculate the sats reward for a single action.
 */
export function calculateActionReward(action: PetsAction): number {
  return ACTION_REWARDS[action] ?? 0;
}

/**
 * Calculate the sats reward for an item-based care action.
 */
export function calculateInventoryActionReward(
  action: InventoryAction,
  quantity: number = 1,
): number {
  if (quantity < 1) return 0;
  const base = INVENTORY_ACTION_REWARDS[action] ?? 0;
  return base * quantity;
}

/**
 * Apply a sats reward to a current balance, never going below zero.
 */
export function applySatsReward(currentSats: number | undefined, reward: number): number {
  return Math.max(0, (currentSats ?? 0) + reward);
}

/**
 * Get a sats reward summary for an action.
 */
export function getSatsRewardSummary(
  action: PetsAction,
  quantity: number = 1,
): { satsGained: number; quantity: number } {
  const base = ACTION_REWARDS[action] ?? 0;
  return { satsGained: base * quantity, quantity };
}

// ─── Display Utilities ────────────────────────────────────────────────────────

/**
 * Format a sats reward for toasts/notifications.
 * Returns an empty string for zero or negative rewards.
 */
export function formatSatsGain(satsGained: number): string {
  if (satsGained <= 0) return '';
  return `+${satsGained.toLocaleString()} sats`;
}

/**
 * Get a descriptive message about a sats reward.
 */
export function getSatsGainMessage(
  action: PetsAction,
  satsGained: number,
  newTotal?: number,
): string {
  if (satsGained <= 0) return '';

  const satsText = formatSatsGain(satsGained);

  if (newTotal !== undefined) {
    return `${satsText} earned! Total: ${newTotal.toLocaleString()} sats`;
  }

  return `${satsText} earned!`;
}
