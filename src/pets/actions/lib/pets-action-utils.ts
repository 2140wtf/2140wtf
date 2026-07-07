// src/pets/actions/lib/pets-action-utils.ts

import { STAT_MIN, STAT_MAX, type PetsCompanion, type PetsStage, type PetsStats, type StorageItem } from '@/pets/core/lib/pets';
import type { ItemEffect, ShopItemCategory } from '@/pets/shop/types/shop.types';
import { getShopItemById } from '@/pets/shop/lib/pets-shop-items';
import { getPetsStatDisplayState, type CareState } from '@/pets/core/lib/pets-segments';

// ─── Action Types ─────────────────────────────────────────────────────────────

/**
 * Item-based care actions (use a shop catalog item on the companion)
 */
export type InventoryAction = 'feed' | 'play' | 'clean' | 'medicine' | 'boost';

/**
 * Direct actions that don't use items.
 * These actions affect stats directly without selecting a shop item.
 */
export type DirectAction = 'play_music' | 'sing';

/**
 * All Pets actions (item-based + direct)
 */
export type PetsAction = InventoryAction | DirectAction;

/**
 * Mapping from action type to allowed item categories
 */
export const ACTION_TO_ITEM_TYPE: Record<InventoryAction, ShopItemCategory> = {
  feed: 'food',
  play: 'toy',
  clean: 'hygiene',
  medicine: 'medicine',
  boost: 'energy',
};

/**
 * Action metadata for UI display (item-based care actions)
 */
export const ACTION_METADATA: Record<InventoryAction, { label: string; description: string; icon: string }> = {
  feed: {
    label: 'Feed',
    description: 'Feed your NOSTR PET',
    icon: '🍎',
  },
  play: {
    label: 'Play',
    description: 'Play with your NOSTR PET',
    icon: '⚽',
  },
  clean: {
    label: 'Clean',
    description: 'Clean your NOSTR PET',
    icon: '🧼',
  },
  medicine: {
    label: 'Medicine',
    description: 'Heal your NOSTR PET',
    icon: '💊',
  },
  boost: {
    label: 'Boost',
    description: 'Recharge your NOSTR PET\'s energy',
    icon: '⚡',
  },
};

/**
 * Action metadata for direct actions (no item required)
 */
export const DIRECT_ACTION_METADATA: Record<DirectAction, { label: string; description: string; icon: string }> = {
  play_music: {
    label: 'Play Music',
    description: 'Play music for your NOSTR PET',
    icon: '🎵',
  },
  sing: {
    label: 'Sing',
    description: 'Sing to your NOSTR PET',
    icon: '🎤',
  },
};

/**
 * Combined action metadata for all action types
 */
export const ALL_ACTION_METADATA: Record<PetsAction, { label: string; description: string; icon: string }> = {
  ...ACTION_METADATA,
  ...DIRECT_ACTION_METADATA,
};

// ─── Stat Helpers ─────────────────────────────────────────────────────────────
// STAT_MIN and STAT_MAX are imported from @/lib/pets (single source of truth)

/**
 * Clamp a stat value between STAT_MIN (1) and an optional max.
 * Safe for undefined values (returns STAT_MIN).
 *
 * The minimum of 1 (instead of 0) ensures:
 * - Pets is never in an unrecoverable state
 * - Visual feedback shows critical state without being "dead"
 * - Recovery is always possible with any healing item
 */
export function clampStat(value: number | undefined, max: number = STAT_MAX): number {
  if (value === undefined) return STAT_MIN;
  return Math.max(STAT_MIN, Math.min(max, Math.round(value)));
}

/**
 * Apply a delta to a stat, clamping the result to STAT_MIN-max.
 */
export function applyStat(
  current: number | undefined,
  delta: number,
  max: number = STAT_MAX,
): number {
  const currentValue = current ?? STAT_MIN;
  return clampStat(currentValue + delta, max);
}

/**
 * Apply item effects to current stats.
 * Returns a new partial stats object with all affected stats clamped.
 * Only modifies stats that have corresponding effects.
 */
export function applyItemEffects(
  currentStats: Partial<PetsStats>,
  effects: ItemEffect,
  max: number = STAT_MAX,
): Partial<PetsStats> {
  const newStats: Partial<PetsStats> = { ...currentStats };

  if (effects.hunger !== undefined) {
    newStats.hunger = applyStat(currentStats.hunger, effects.hunger, max);
  }
  if (effects.happiness !== undefined) {
    newStats.happiness = applyStat(currentStats.happiness, effects.happiness, max);
  }
  if (effects.energy !== undefined) {
    newStats.energy = applyStat(currentStats.energy, effects.energy, max);
  }
  if (effects.hygiene !== undefined) {
    newStats.hygiene = applyStat(currentStats.hygiene, effects.hygiene, max);
  }
  if (effects.health !== undefined) {
    newStats.health = applyStat(currentStats.health, effects.health, max);
  }

  return newStats;
}

// ─── Egg-Specific Item Helpers ────────────────────────────────────────────────

/**
 * The Shell Repair Kit is a special medicine item only usable by eggs.
 */
export const SHELL_REPAIR_KIT_ID = 'med_shell_repair';

/**
 * Result of checking if an item can be used by a specific Pets stage.
 */
export interface ItemUsabilityResult {
  canUse: boolean;
  reason?: string;
}

/**
 * Check if a specific item can be used by a companion at the given stage.
 * 
 * This is the centralized item usability logic:
 * - Shell Repair Kit: Only usable by eggs
 * - Food items: Only usable by baby/adult (not eggs)
 * - Toy items: Only usable by baby/adult (not eggs)
 * - Medicine items (except Shell Repair Kit): Usable by all stages with health effect
 * - Hygiene items: Usable by all stages
 * 
 * @param itemId - The shop item ID
 * @param stage - The companion's life stage
 * @returns Object with canUse boolean and optional reason string
 */
export function canUseItemForStage(
  itemId: string,
  stage: 'egg' | 'baby' | 'adult'
): ItemUsabilityResult {
  const shopItem = getShopItemById(itemId);
  if (!shopItem) {
    return { canUse: false, reason: 'Item not found' };
  }

  const isEgg = stage === 'egg';

  // Shell Repair Kit special case: only for eggs
  if (itemId === SHELL_REPAIR_KIT_ID) {
    if (!isEgg) {
      return { canUse: false, reason: 'Only usable for eggs' };
    }
    return { canUse: true };
  }

  // Food items: not usable by eggs
  if (shopItem.type === 'food') {
    if (isEgg) {
      return { canUse: false, reason: 'Eggs cannot eat food' };
    }
    return { canUse: true };
  }

  // Toy items: not usable by eggs
  if (shopItem.type === 'toy') {
    if (isEgg) {
      return { canUse: false, reason: 'Eggs cannot use toys' };
    }
    return { canUse: true };
  }

  // Medicine items (except Shell Repair Kit): check for health effect
  if (shopItem.type === 'medicine') {
    if (!hasMedicineEffectForEgg(shopItem.effect)) {
      return { canUse: false, reason: 'This medicine has no effect' };
    }
    return { canUse: true };
  }

  // Hygiene items: all stages can use
  if (shopItem.type === 'hygiene') {
    if (!hasHygieneEffectForEgg(shopItem.effect) && !hasHappinessEffectForEgg(shopItem.effect)) {
      return { canUse: false, reason: 'This item has no cleaning effect' };
    }
    return { canUse: true };
  }

  // Energy items: not usable by eggs (egg energy is fixed at 100)
  if (shopItem.type === 'energy') {
    if (isEgg) {
      return { canUse: false, reason: 'Eggs do not need energy boosts' };
    }
    return { canUse: true };
  }

  return { canUse: true };
}

/**
 * Get the action type for a given item.
 */
export function getActionForItem(itemId: string): InventoryAction | null {
  const shopItem = getShopItemById(itemId);
  if (!shopItem) return null;

  const typeToAction: Record<string, InventoryAction> = {
    food: 'feed',
    toy: 'play',
    hygiene: 'clean',
    medicine: 'medicine',
    energy: 'boost',
  };

  return typeToAction[shopItem.type] ?? null;
}

/**
 * Check if a medicine item has any effect on an egg.
 * 
 * Eggs use the standard 3-stat model:
 * - health
 * - hygiene  
 * - happiness
 * 
 * Medicine with a health effect will directly affect the egg's health stat.
 */
export function hasMedicineEffectForEgg(effects: ItemEffect | undefined): boolean {
  if (!effects) return false;
  return effects.health !== undefined && effects.health !== 0;
}

/**
 * Check if a hygiene item has any effect on an egg.
 * Hygiene items with a hygiene effect will directly affect the egg's hygiene stat.
 */
export function hasHygieneEffectForEgg(effects: ItemEffect | undefined): boolean {
  if (!effects) return false;
  return effects.hygiene !== undefined && effects.hygiene !== 0;
}

/**
 * Check if an item has a happiness effect for an egg.
 * Some items (like bubble bath) give happiness bonus in addition to primary effects.
 */
export function hasHappinessEffectForEgg(effects: ItemEffect | undefined): boolean {
  if (!effects) return false;
  return effects.happiness !== undefined && effects.happiness !== 0;
}

// ─── Item Helpers ─────────────────────────────────────────────────────────────

/**
 * Decrement item quantity in storage array.
 * If quantity becomes 0, removes the item entirely.
 * Returns a new storage array (immutable).
 */
export function decrementStorageItem(
  storage: StorageItem[],
  itemId: string,
  amount = 1
): StorageItem[] {
  const result: StorageItem[] = [];

  for (const item of storage) {
    if (item.itemId !== itemId) {
      result.push(item);
      continue;
    }
    const newQuantity = item.quantity - amount;
    if (newQuantity > 0) {
      result.push({ ...item, quantity: newQuantity });
    }
    // If newQuantity <= 0, we don't add it (remove item)
  }

  return result;
}

// ─── Stage Restriction Helpers ────────────────────────────────────────────────

/**
 * Stages that can use general items (food, toys, hygiene)
 */
export const GENERAL_ITEM_USABLE_STAGES = ['baby', 'adult'] as const;

/**
 * Inventory actions that are allowed for eggs.
 * Eggs can use: medicine (health), clean (hygiene)
 */
export const EGG_ALLOWED_INVENTORY_ACTIONS: InventoryAction[] = ['medicine', 'clean'];

/**
 * Direct actions that are allowed for eggs.
 * All direct actions work on eggs.
 */
export const EGG_ALLOWED_DIRECT_ACTIONS: DirectAction[] = ['play_music', 'sing'];

/**
 * Inventory actions visible in the egg UI.
 * Note: feed, play, sleep are hidden in the UI for eggs but not hard-blocked.
 */
export const EGG_VISIBLE_INVENTORY_ACTIONS: InventoryAction[] = ['clean', 'medicine'];

/**
 * All actions visible in the egg UI.
 */
export const EGG_VISIBLE_ACTIONS: PetsAction[] = ['clean', 'medicine', 'play_music', 'sing'];

/**
 * @deprecated Use EGG_ALLOWED_INVENTORY_ACTIONS instead
 */
export const EGG_ALLOWED_ACTIONS = EGG_ALLOWED_INVENTORY_ACTIONS;

/**
 * Check if a companion can use a specific item action.
 * 
 * Note: This function no longer hard-blocks egg actions at the domain layer.
 * UI visibility is handled separately by `isActionVisibleForStage()`.
 * The domain layer allows all actions - UI chooses what to show.
 */
export function canUseAction(_companion: PetsCompanion, _action: InventoryAction): boolean {
  // All stages can technically use all item actions at the domain layer.
  // UI filtering determines what actions are shown to users.
  return true;
}

/**
 * Check if a companion can use a specific direct action.
 * Direct actions (play_music, sing) are available for all stages.
 */
export function canUseDirectAction(_companion: PetsCompanion, _action: DirectAction): boolean {
  // All stages can use direct actions
  return true;
}

/**
 * Check if an action should be visible in the UI for a given stage.
 * This is for UI filtering only - some actions are hidden but not blocked.
 */
export function isActionVisibleForStage(stage: 'egg' | 'baby' | 'adult', action: PetsAction): boolean {
  if (stage === 'egg') {
    return EGG_VISIBLE_ACTIONS.includes(action);
  }
  return true; // baby and adult see all actions
}

/**
 * Check if a companion can use general items (feed, play, clean).
 * Eggs cannot use food, toys, or hygiene items.
 * @deprecated Use canUseAction(companion, action) for action-specific checks
 */
export function canUseInventoryItems(companion: PetsCompanion): boolean {
  return GENERAL_ITEM_USABLE_STAGES.includes(companion.stage as typeof GENERAL_ITEM_USABLE_STAGES[number]);
}

/**
 * Get a user-friendly message explaining why an action can't be used.
 */
export function getStageRestrictionMessage(companion: PetsCompanion, action?: InventoryAction): string | null {
  if (companion.stage === 'egg') {
    if (action && EGG_ALLOWED_INVENTORY_ACTIONS.includes(action)) {
      return null; // Medicine and clean are allowed for eggs
    }
    return 'Eggs cannot use this item. Wait for your NOSTR PET to hatch!';
  }
  return null;
}

// ─── Segment-aware stat preview ───────────────────────────────────────────────

/**
 * A single stat change enriched with segment (bar) impact.
 *
 * Pure and deterministic — depends only on the inputs.
 */
export interface StatChangeWithSegments {
  /** Which stat is affected. */
  stat: keyof PetsStats;
  /** Raw delta from the item effect (before clamping). */
  delta: number;
  /** Current stat value (clamped 1–100). */
  beforeValue: number;
  /** Projected stat value after applying the delta (clamped 1–100). */
  afterValue: number;
  /** Filled segments before applying the delta. */
  beforeSegments: number;
  /** Filled segments after applying the delta. */
  afterSegments: number;
  /** Change in filled segments (afterSegments − beforeSegments). */
  segmentDelta: number;
  /** Maximum segments for the current stage. */
  maxSegments: number;
  /** Care state before applying the delta. */
  beforeCareState: CareState;
  /** Care state after applying the delta. */
  afterCareState: CareState;
}

/**
 * Preview stat changes with segment (bar) impact for each affected stat.
 *
 * Uses `getPetsStatDisplayState` to derive segment counts before and after
 * the item effect, so the result exactly matches what the user sees in the
 * stat rings.
 *
 * For eggs, `segmentDelta` is always 0 because eggs are visually protected
 * (all bars shown as full regardless of the internal value).
 */
export function previewStatChangesWithSegments(
  currentStats: Partial<PetsStats>,
  effects: ItemEffect | undefined,
  stage: PetsStage,
): StatChangeWithSegments[] {
  if (!effects) return [];

  const changes: StatChangeWithSegments[] = [];
  const statKeys: (keyof PetsStats)[] = ['hunger', 'happiness', 'energy', 'hygiene', 'health'];

  for (const stat of statKeys) {
    const delta = effects[stat];
    if (delta === undefined || delta === 0) continue;

    const beforeValue = clampStat(currentStats[stat] ?? 0);
    const afterValue = clampStat(beforeValue + delta);

    const before = getPetsStatDisplayState({ stage, stat, value: beforeValue });
    const after = getPetsStatDisplayState({ stage, stat, value: afterValue });

    changes.push({
      stat,
      delta,
      beforeValue,
      afterValue,
      beforeSegments: before.filled,
      afterSegments: after.filled,
      segmentDelta: after.filled - before.filled,
      maxSegments: before.max,
      beforeCareState: before.careState,
      afterCareState: after.careState,
    });
  }

  return changes;
}

