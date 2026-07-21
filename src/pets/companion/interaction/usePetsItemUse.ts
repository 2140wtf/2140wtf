import { queryPetsRelay } from '@/pets/core/lib/pets-relay';
/**
 * usePetsItemUse Hook
 * 
 * Shared hook that provides real Pets item-use logic that can work
 * both inside and outside of PetsPage.
 * 
 * This hook:
 * - Fetches companion and profile data if not provided
 * - Uses the same item-use logic as PetsPage (usePetsUseInventoryItem)
 * - Works as a standalone hook or can be passed cached data
 * - Provides retry protection and cooldown
 * 
 * Architecture:
 * - PetsCompanionLayer uses this hook directly as a fallback when 
 *   PetsPage is not mounted
 * - PetsPage registers its own item-use function (which has better cache access)
 * - Both use the same underlying mutation logic
 */

import { useCallback, useRef, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPetProfile } from '@/hooks/useNostrPetProfile';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';

import type { NostrEvent } from '@nostrify/nostrify';
import type { PetsCompanion, NostrPetProfile } from '@/pets/core/lib/pets';
import {
  KIND_PETS_STATE,
  KIND_NOSTR_PET_PROFILE,
  updatePetsTags,
  parsePetsEvent,
  isValidPetsEvent,
  parseNostrPetProfileEvent,
} from '@/pets/core/lib/pets';
import { fetchFreshPetsEvent } from '@/pets/core/lib/fetchFreshPetsEvent';
import { applyPetsDecayForCompanion } from '@/pets/core/lib/pets-decay';
import { getEffectiveStatCap } from '@/pets/core/lib/category-abilities';
import { getShopItemById } from '@/pets/shop/lib/pets-shop-items';
import {
  applyItemEffects,
  canUseAction,
  canUseItemForStage,
  getStageRestrictionMessage,
  clampStat,
  applyStat,
  hasMedicineEffectForEgg,
  hasHygieneEffectForEgg,
  type InventoryAction,
  ACTION_METADATA,
} from '@/pets/actions/lib/pets-action-utils';
import { trackEvolutionMissionTally, readEvolutionFromStorage, trackInventoryDailyActions } from '@/pets/actions/lib/daily-mission-tracker';
import { serializeEvolutionContent } from '@/pets/core/lib/missions';
import { getStreakTagUpdates } from '@/pets/actions/lib/pets-streak';
import { INTERNAL_TO_INTERACTION_ACTION, emitInteractionEvent } from '@/pets/core/lib/pets-interaction';
import { consumeStorageItem, restoreStorageItem } from '@/pets/core/lib/profile-sats';

import type { UseItemFunction } from './PetsActionsContextDef';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Cooldown time after a failed item use attempt (ms) */
const ITEM_USE_COOLDOWN_MS = 3000;

/** Cooldown time after a successful item use (ms) - shorter to allow quick successive uses */
const ITEM_USE_SUCCESS_COOLDOWN_MS = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UsePetsItemUseOptions {
  /** 
   * Override companion - if provided, skip fetching.
   * Useful when called from PetsPage which already has the data.
   */
  companion?: PetsCompanion | null;
  /** 
   * Override profile - if provided, skip fetching.
   */
  profile?: NostrPetProfile | null;
  /** Called to update the profile event in the query cache after sats are awarded. */
  updateProfileEvent?: (event: NostrEvent) => void;
}

export interface UsePetsItemUseResult {
  /** The item use function - same signature as UseItemFunction */
  useItem: UseItemFunction;
  /** Whether item use is available (companion and profile loaded) */
  canUseItems: boolean;
  /** Whether an item use is currently in progress */
  isUsingItem: boolean;
  /** Check if an item is on cooldown (recently attempted) */
  isItemOnCooldown: (itemId: string) => boolean;
  /** Clear cooldown for an item (e.g., after it's removed) */
  clearItemCooldown: (itemId: string) => void;
}

interface ItemCooldownEntry {
  /** Timestamp when the cooldown expires */
  expiresAt: number;
  /** Whether the last attempt succeeded */
  wasSuccess: boolean;
}

// ─── Hook Implementation ──────────────────────────────────────────────────────

/**
 * Shared Pets item-use hook that works anywhere.
 * 
 * This is the "real" item-use logic extracted to be usable from:
 * - PetsCompanionLayer (floating companion)
 * - PetsPage (main dashboard)
 * - Any other location
 * 
 * Features:
 * - Fetches companion/profile data if not provided
 * - Identical item-use logic to usePetsUseInventoryItem
 * - Built-in per-item cooldown/retry protection
 * - Works as a direct hook or registered in context
 */
export function usePetsItemUse(options: UsePetsItemUseOptions = {}): UsePetsItemUseResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const queryClient = useQueryClient();
  
  // Fetch profile if not provided
  const { profile: fetchedProfile } = useNostrPetProfile();
  const profile = options.profile ?? fetchedProfile;
  const updateProfileEvent = options.updateProfileEvent;
  
  // Per-item cooldown tracking (ref to avoid re-renders)
  const itemCooldowns = useRef<Map<string, ItemCooldownEntry>>(new Map());
  
  // Check if an item is on cooldown
  const isItemOnCooldown = useCallback((itemId: string): boolean => {
    const entry = itemCooldowns.current.get(itemId);
    if (!entry) return false;
    
    const now = Date.now();
    if (now >= entry.expiresAt) {
      // Cooldown expired, remove it
      itemCooldowns.current.delete(itemId);
      return false;
    }
    
    return true;
  }, []);
  
  // Clear cooldown for an item
  const clearItemCooldown = useCallback((itemId: string): void => {
    itemCooldowns.current.delete(itemId);
  }, []);
  
  // Set cooldown for an item
  const setItemCooldown = useCallback((itemId: string, success: boolean): void => {
    const cooldownMs = success ? ITEM_USE_SUCCESS_COOLDOWN_MS : ITEM_USE_COOLDOWN_MS;
    itemCooldowns.current.set(itemId, {
      expiresAt: Date.now() + cooldownMs,
      wasSuccess: success,
    });
  }, []);
  
  // Fetch current companion based on profile's currentCompanion
  // This is fetched on-demand when needed, not kept in state
  const fetchCurrentCompanion = useCallback(async (): Promise<PetsCompanion | null> => {
    // If companion was provided via options, use that
    if (options.companion !== undefined) {
      return options.companion ?? null;
    }
    
    if (!user?.pubkey || !profile?.currentCompanion) {
      return null;
    }
    
    const events = await queryPetsRelay(nostr, [{
      kinds: [KIND_PETS_STATE],
      authors: [user.pubkey],
      '#d': [profile.currentCompanion],
    }]);
    
    const validEvents = events
      .filter(isValidPetsEvent)
      .sort((a, b) => b.created_at - a.created_at);
    
    if (validEvents.length === 0) return null;
    
    return parsePetsEvent(validEvents[0]) ?? null;
  }, [nostr, user?.pubkey, profile?.currentCompanion, options.companion]);
  
  // Update companion in query cache - optimistic update for immediate UI refresh
  const updateCompanionInCache = useCallback((event: NostrEvent) => {
    if (!user?.pubkey || !profile?.currentCompanion) return;
    
    // Parse the new event to get the updated companion
    const parsed = parsePetsEvent(event);
    if (!parsed) {
      // Fallback to invalidation if parsing fails
      queryClient.invalidateQueries({ 
        queryKey: ['pets-collection', user.pubkey] 
      });
      return;
    }
    
    // Optimistically update the pets-collection cache
    // This ensures the companion layer sees the update immediately
    queryClient.setQueryData<{ companionsByD: Record<string, PetsCompanion>; companions: PetsCompanion[] } | undefined>(
      // Use partial key match - React Query will find any matching query
      ['pets-collection', user.pubkey],
      (prev) => {
        if (!prev) return prev;
        
        // Update the specific companion in the record
        const newCompanionsByD = {
          ...prev.companionsByD,
          [parsed.d]: parsed,
        };
        
        // Rebuild companions array from the record
        const newCompanions = Object.values(newCompanionsByD);
        
        return {
          companionsByD: newCompanionsByD,
          companions: newCompanions,
        };
      },
    );
    
    // Also invalidate to trigger background refetch (ensures consistency)
    queryClient.invalidateQueries({ 
      queryKey: ['pets-collection', user.pubkey] 
    });
  }, [queryClient, user?.pubkey, profile?.currentCompanion]);
  
  // Core mutation for using items (always uses once)
  const mutation = useMutation({
    mutationFn: async ({ 
      itemId, 
      action, 
    }: { 
      itemId: string; 
      action: InventoryAction; 
    }): Promise<{ statsChanged: Record<string, number> }> => {
      // ─── Validation ───
      if (!user?.pubkey) {
        throw new Error('You must be logged in to use items');
      }
      
      if (!profile) {
        throw new Error('Profile not found');
      }
      
      // Fetch fresh companion data
      const companion = await fetchCurrentCompanion();

      if (!companion) {
        throw new Error('No companion selected');
      }

      // Fetch fresh profile so a purchase/consumption elsewhere does not leave
      // the ownership check stale.
      const freshProfileEvent = await fetchFreshPetsEvent(nostr, {
        kinds: [KIND_NOSTR_PET_PROFILE],
        authors: [user.pubkey],
      });
      const freshProfile = freshProfileEvent ? parseNostrPetProfileEvent(freshProfileEvent) : profile;
      if (!freshProfile) {
        throw new Error('Profile data is invalid');
      }

      // Check stage restrictions
      if (!canUseAction(companion, action)) {
        const message = getStageRestrictionMessage(companion, action);
        throw new Error(message ?? 'This companion cannot use this item');
      }
      
      // Validate item exists in shop catalog
      const shopItem = getShopItemById(itemId);
      if (!shopItem) {
        throw new Error('Item not found in catalog');
      }
      
      // Validate item can be used by this companion's stage
      // This catches egg-only items (like Shell Repair Kit) being used by baby/adult companions
      const itemUsability = canUseItemForStage(itemId, companion.stage);
      if (!itemUsability.canUse) {
        throw new Error(itemUsability.reason ?? 'This item cannot be used by this companion');
      }
      
      // Validate item has effects
      if (!shopItem.effect) {
        throw new Error('This item has no effect');
      }

      // Validate the user owns the item using the freshly fetched profile
      const owned = freshProfile.storage.find((s) => s.itemId === itemId);
      if (!owned || owned.quantity <= 0) {
        throw new Error(`You don't own ${shopItem.name}. Buy it in the shop first.`);
      }
      
      // For eggs, validate that items have applicable effects
      const isEgg = companion.stage === 'egg';
      if (isEgg && action === 'medicine' && !hasMedicineEffectForEgg(shopItem.effect)) {
        throw new Error('This medicine has no effect on eggs');
      }
      if (isEgg && action === 'clean' && !hasHygieneEffectForEgg(shopItem.effect)) {
        throw new Error('This item has no cleaning effect on eggs');
      }
      
      // ─── Apply Accumulated Decay First ───
      const now = Math.floor(Date.now() / 1000);
      const decayResult = applyPetsDecayForCompanion(companion, now);
      
      // Start with decayed stats as the base
      const statsAfterDecay = decayResult.stats;

      // Effective stat cap for this companion (category + rarity). Stored tags
      // remain clamped to 100 for backward compatibility; the effective cap is
      // used for effect calculations so care actions can still grant sats/mission
      // progress when stored stats are already maxed.
      const effectiveMax = getEffectiveStatCap(
        companion.breedCategory,
        companion.baoRarity,
      );
      
      // ─── Apply Item Effects (single use) ───
      const isEggCompanion = companion.stage === 'egg';
      const statsUpdate: Record<string, string> = {};
      const statsChanged: Record<string, number> = {};
      
      if (isEggCompanion && action === 'medicine') {
        const currentHealth = applyStat(statsAfterDecay.health ?? 0, shopItem.effect.health ?? 0);
        
        statsUpdate.health = currentHealth.toString();
        statsChanged.health = currentHealth - (statsAfterDecay.health ?? 0);
        
        statsUpdate.hygiene = (statsAfterDecay.hygiene ?? 0).toString();
        statsUpdate.happiness = (statsAfterDecay.happiness ?? 0).toString();
        statsUpdate.hunger = '100';
        statsUpdate.energy = '100';
      } else if (isEggCompanion && action === 'clean') {
        const currentHygiene = applyStat(statsAfterDecay.hygiene ?? 0, shopItem.effect.hygiene ?? 0);
        const currentHappiness = applyStat(statsAfterDecay.happiness ?? 0, shopItem.effect.happiness ?? 0);
        
        statsUpdate.hygiene = currentHygiene.toString();
        statsChanged.hygiene = currentHygiene - (statsAfterDecay.hygiene ?? 0);
        
        statsUpdate.happiness = currentHappiness.toString();
        const totalHappinessChange = currentHappiness - (statsAfterDecay.happiness ?? 0);
        if (totalHappinessChange !== 0) {
          statsChanged.happiness = totalHappinessChange;
        }
        
        statsUpdate.health = (statsAfterDecay.health ?? 0).toString();
        statsUpdate.hunger = '100';
        statsUpdate.energy = '100';
      } else {
        // Normal stats application for baby/adult — apply once
        const currentStats = applyItemEffects({ ...statsAfterDecay }, shopItem.effect, effectiveMax);
        
        // Stored tags remain clamped to 100 for backward compatibility.
        statsUpdate.hunger = clampStat(currentStats.hunger, 100).toString();
        statsChanged.hunger = (currentStats.hunger ?? 0) - (statsAfterDecay.hunger ?? 0);
        
        statsUpdate.happiness = clampStat(currentStats.happiness, 100).toString();
        statsChanged.happiness = (currentStats.happiness ?? 0) - (statsAfterDecay.happiness ?? 0);
        
        statsUpdate.energy = clampStat(currentStats.energy, 100).toString();
        statsChanged.energy = (currentStats.energy ?? 0) - (statsAfterDecay.energy ?? 0);
        
        statsUpdate.hygiene = clampStat(currentStats.hygiene, 100).toString();
        statsChanged.hygiene = (currentStats.hygiene ?? 0) - (statsAfterDecay.hygiene ?? 0);
        
        statsUpdate.health = clampStat(currentStats.health, 100).toString();
        statsChanged.health = (currentStats.health ?? 0) - (statsAfterDecay.health ?? 0);
      }
      
      // ─── Update Pets State Event (kind 31124) ───
      const nowStr = now.toString();
      
      // If incubating or evolving, increment the interaction counter in evolution missions
      const progressionState = companion.progressionState;
      const updatedTags = companion.allTags;
      if (progressionState === 'incubating' || progressionState === 'evolving') {
        trackEvolutionMissionTally('interactions', 1, user?.pubkey, companion.d);
      }
      
      // ─── Build content with latest evolution state ───
      let content = companion.event.content;
      if (progressionState === 'incubating' || progressionState === 'evolving') {
        const evo = readEvolutionFromStorage(user?.pubkey, companion.d);
        if (evo && evo.length > 0) {
          content = serializeEvolutionContent(companion.event.content, evo);
        }
      }

      // Get streak updates (will only update if needed based on day)
      const streakUpdates = getStreakTagUpdates(companion) ?? {};
      
      const petsTags = updatePetsTags(updatedTags, {
        ...statsUpdate,
        ...streakUpdates,
        last_interaction: nowStr,
        last_decay_at: nowStr,
      });
      
      // Consume one unit from storage BEFORE applying the pet stat update. This
      // prevents the pet from receiving a free stat boost if the storage
      // decrement cannot be published. If the pet-state publish fails after the
      // decrement, we restore the item so it is not lost.
      let consumed = false;
      if (user?.pubkey) {
        const { consumed: ok } = await consumeStorageItem(nostr, publishEvent, user.pubkey, itemId);
        if (!ok) {
          throw new Error(`You don't own ${shopItem.name}. Buy it in the shop first.`);
        }
        consumed = true;
      }

      let petsEvent: NostrEvent;
      try {
        petsEvent = await publishEvent({
          kind: KIND_PETS_STATE,
          content,
          tags: petsTags,
          prev: companion.event,
        });
      } catch (petEventError) {
        if (consumed && user?.pubkey) {
          try {
            await restoreStorageItem(nostr, publishEvent, user.pubkey, itemId);
          } catch (restoreError) {
            console.error('[usePetsItemUse] Failed to restore storage item after pet event failure:', restoreError);
          }
        }
        throw petEventError;
      }

      updateCompanionInCache(petsEvent);

      // Update the profile cache with the freshly published profile event.
      if (user?.pubkey) {
        const freshEventAfterConsume = await fetchFreshPetsEvent(nostr, {
          kinds: [KIND_NOSTR_PET_PROFILE],
          authors: [user.pubkey],
        });
        if (freshEventAfterConsume) {
          if (updateProfileEvent) {
            updateProfileEvent(freshEventAfterConsume);
          } else if (user?.pubkey) {
            queryClient.setQueryData(['nostr-pet-profile', user.pubkey], freshEventAfterConsume);
          }
        }
      }

      // ─── Emit kind 1124 interaction event (best-effort, fire-and-forget) ───
      // ownerPubkey comes from the target Pets event, not the logged-in user,
      // so the tags remain correct if this path is later reused for non-owner interactions.
      const interactionAction = INTERNAL_TO_INTERACTION_ACTION[action];
      if (interactionAction && companion) {
        emitInteractionEvent(publishEvent, {
          ownerPubkey: companion.event.pubkey,
          petsDTag: companion.d,
          action: interactionAction,
          source: 'companion',
          itemId,
        });
      }

      // ─── Invalidate Queries ───
      queryClient.invalidateQueries({ queryKey: ['pets-collection', user.pubkey] });

      // Invalidate interactions query so social projection reflects the new 1124.
      {
        const coordinate = `31124:${companion.event.pubkey}:${companion.d}`;
        queryClient.invalidateQueries({
          queryKey: ['pets-interactions', coordinate],
        });
      }

      return { statsChanged };
    },
    onSuccess: (_, { itemId, action }) => {
      const shopItem = getShopItemById(itemId);
      const actionMeta = ACTION_METADATA[action];

      toast({
        title: `${actionMeta.label} successful!`,
        description: `Used ${shopItem?.name ?? 'item'} on your Pets.`,
      });
      
      // Track daily mission progress
      trackInventoryDailyActions(action, user?.pubkey);
      
      // Set success cooldown (short)
      setItemCooldown(itemId, true);
    },
    onError: (error: Error, { itemId }) => {
      toast({
        title: 'Failed to use item',
        description: error.message,
        variant: 'destructive',
      });
      
      // Set failure cooldown (longer)
      setItemCooldown(itemId, false);
    },
  });
  
  // Wrapper function that matches UseItemFunction signature and includes cooldown check
  const useItem = useCallback<UseItemFunction>(async (itemId, action) => {
    // Check cooldown first
    if (isItemOnCooldown(itemId)) {
      if (import.meta.env.DEV) {
        console.log('[usePetsItemUse] Item on cooldown, skipping:', itemId);
      }
      return {
        success: false,
        error: 'Please wait before trying again',
      };
    }
    
    try {
      const result = await mutation.mutateAsync({ itemId, action });
      return {
        success: true,
        statsChanged: result.statsChanged,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }, [mutation, isItemOnCooldown]);
  
  // Determine if items can be used
  const canUseItems = useMemo(() => {
    return !!user?.pubkey && !!profile?.currentCompanion;
  }, [user?.pubkey, profile?.currentCompanion]);
  
  return {
    useItem,
    canUseItems,
    isUsingItem: mutation.isPending,
    isItemOnCooldown,
    clearItemCooldown,
  };
}
