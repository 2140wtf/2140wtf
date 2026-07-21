// src/pets/actions/hooks/usePetsUseInventoryItem.ts

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';

import type { PetsCompanion, NostrPetProfile } from '@/pets/core/lib/pets';
import {
  KIND_PETS_STATE,
  updatePetsTags,
} from '@/pets/core/lib/pets';
import { applyPetsDecayForCompanion } from '@/pets/core/lib/pets-decay';
import { getEffectiveStatCap } from '@/pets/core/lib/category-abilities';
import { getShopItemById } from '@/pets/shop/lib/pets-shop-items';
import {
  applyItemEffects,
  canUseAction,
  getStageRestrictionMessage,
  clampStat,
  applyStat,
  hasMedicineEffectForEgg,
  hasHygieneEffectForEgg,
  type InventoryAction,
  ACTION_METADATA,
} from '../lib/pets-action-utils';
import { calculateInventoryActionReward } from '../lib/pets-action-rewards';
import { trackEvolutionMissionTally, readEvolutionFromStorage, trackInventoryDailyActions } from '../lib/daily-mission-tracker';
import { serializeEvolutionContent } from '@/pets/core/lib/missions';
import { getStreakTagUpdates } from '../lib/pets-streak';
import { INTERNAL_TO_INTERACTION_ACTION, emitInteractionEvent } from '@/pets/core/lib/pets-interaction';
import { consumeStorageItem } from '@/pets/core/lib/profile-sats';
import { addProfileSats } from '@/pets/core/lib/profile-sats';

// Import NostrEvent type
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Request payload for using an item on a Pets companion
 */
export interface UseItemRequest {
  itemId: string;
  action: InventoryAction;
}

/**
 * Result of using an item on a Pets companion
 */
export interface UseItemResult {
  itemName: string;
  action: InventoryAction;
  statsChanged: Record<string, number>;
  satsGained: number;
}

/**
 * Parameters for the usePetsUseInventoryItem hook
 */
export interface UsePetsUseInventoryItemParams {
  companion: PetsCompanion | null;
  profile: NostrPetProfile | null;
  /** Called after ensuring companion is canonical (from migration helper) */
  ensureCanonicalBeforeAction: () => Promise<{
    companion: PetsCompanion;
    content: string;
    allTags: string[][];
    wasMigrated: boolean;
    /** Latest profile tags after migration */
    profileAllTags: string[][];
    /** Latest profile storage after migration */
    profileStorage: import('@/pets/core/lib/pets').StorageItem[];
  } | null>;
  /** Update companion event in local cache */
  updateCompanionEvent: (event: NostrEvent) => void;
  /** Update profile event in local cache */
  updateProfileEvent: (event: NostrEvent) => void;
  /** UI surface originating the interaction (used for kind 1124 source tag). Defaults to 'pets-page'. */
  interactionSource?: string;
}

/**
 * Hook to use an item on a Pets companion.
 * 
 * Items are reusable abilities sourced from the shop catalog — no
 * inventory ownership or quantity is required.
 * 
 * This hook:
 * 1. Validates the companion and item compatibility
 * 2. Ensures canonical format before action
 * 3. Applies accumulated decay, then item effects to Pets stats
 * 4. Updates Pets state (kind 31124)
 */
export function usePetsUseInventoryItem({
  companion,
  profile,
  ensureCanonicalBeforeAction,
  updateCompanionEvent,
  updateProfileEvent,
  interactionSource = 'pets-page',
}: UsePetsUseInventoryItemParams) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, action }: UseItemRequest): Promise<UseItemResult> => {
      // ─── Validation ───
      if (!user?.pubkey) {
        throw new Error('You must be logged in to use items');
      }

      if (!companion) {
        throw new Error('No companion selected');
      }

      if (!profile) {
        throw new Error('Profile not found');
      }

      // Validate item exists in shop catalog
      const shopItem = getShopItemById(itemId);
      if (!shopItem) {
        throw new Error('Item not found in catalog');
      }

      // Validate item has effects
      if (!shopItem.effect) {
        throw new Error('This item has no effect');
      }

      // ─── Ensure Canonical Before Action ───
      const canonical = await ensureCanonicalBeforeAction();
      if (!canonical) {
        throw new Error('Failed to prepare companion for action');
      }

      // Check stage restrictions for this specific action using the canonical
      // companion, not the stale outer prop. This closes the bypass where the
      // outer companion allowed an action that the freshly-read canonical state
      // (e.g. an egg) should reject.
      if (!canUseAction(canonical.companion, action)) {
        const message = getStageRestrictionMessage(canonical.companion, action);
        throw new Error(message ?? 'This companion cannot use this item');
      }

      // For eggs, validate that items have applicable effects
      const isCanonicalEgg = canonical.companion.stage === 'egg';
      if (isCanonicalEgg && action === 'medicine' && !hasMedicineEffectForEgg(shopItem.effect)) {
        throw new Error('This medicine has no effect on eggs');
      }
      if (isCanonicalEgg && action === 'clean' && !hasHygieneEffectForEgg(shopItem.effect)) {
        throw new Error('This item has no cleaning effect on eggs');
      }

      // ─── Validate ownership from the freshest canonical profile ───
      // The canonical fetch already pulled the latest profile storage, so we can
      // verify the user actually owns the item before mutating pet state.
      const ownedQuantity = canonical.profileStorage.find((s) => s.itemId === itemId)?.quantity ?? 0;
      if (ownedQuantity <= 0) {
        throw new Error(`You don't own ${shopItem.name}. Buy it in the shop first.`);
      }

      // ─── Apply Accumulated Decay First ───
      // Per decay-system.md: Always apply accumulated decay from persisted state
      // before any user interaction updates stats.
      // CRITICAL: Use canonical.companion for decay calculations, not the stale outer companion
      const now = Math.floor(Date.now() / 1000);
      const decayResult = applyPetsDecayForCompanion(canonical.companion, now);
      
      // Start with decayed stats as the base
      const statsAfterDecay = decayResult.stats;

      // Effective stat cap for this companion (category + rarity). Stored tags
      // remain clamped to 100 for backward compatibility; the effective cap is
      // used for effect calculations and "would have effect" checks so care
      // actions can still grant XP/mission progress when stored stats are maxed.
      const effectiveMax = getEffectiveStatCap(
        canonical.companion.breedCategory,
        canonical.companion.baoRarity,
      );
      
      // ─── Validate Play Energy Requirements ───
      // For play actions, validate the Pets has enough energy AFTER decay
      if (action === 'play') {
        const energyCost = Math.abs(shopItem.effect.energy ?? 0);
        const currentEnergy = statsAfterDecay.energy;
        
        if (energyCost > 0 && currentEnergy < energyCost) {
          throw new Error(
            `Your NOSTR PET needs at least ${energyCost} energy to play with this toy (current: ${currentEnergy})`
          );
        }
        
        // Also check if playing would have any effect at all
        // If happiness is maxed AND we can't spend energy, playing is pointless
        const happinessGain = shopItem.effect.happiness ?? 0;
        const currentHappiness = statsAfterDecay.happiness;
        const wouldGainHappiness = happinessGain > 0 && currentHappiness < effectiveMax;
        const wouldSpendEnergy = energyCost > 0 && currentEnergy >= energyCost;
        
        if (!wouldGainHappiness && !wouldSpendEnergy) {
          throw new Error(
            'Playing would have no effect - your NOSTR PET is already at maximum happiness and has no energy to spend'
          );
        }
      }
      
      // ─── Apply Item Effects (single use) ───
      const isEggCompanion = canonical.companion.stage === 'egg';
      const statsUpdate: Record<string, string> = {};
      const statsChanged: Record<string, number> = {};

      if (isEggCompanion && action === 'medicine') {
        const healthDelta = shopItem.effect.health ?? 0;
        const currentHealth = applyStat(statsAfterDecay.health ?? 0, healthDelta);
        
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
      const progressionState = canonical.companion.progressionState;
      const updatedTags = canonical.allTags;
      if (progressionState === 'incubating' || progressionState === 'evolving') {
        trackEvolutionMissionTally('interactions', 1, user?.pubkey, canonical.companion.d);
      }
      
      // ─── Build content with latest evolution state ───
      let content = canonical.content;
      if (progressionState === 'incubating' || progressionState === 'evolving') {
        const evo = readEvolutionFromStorage(user?.pubkey, canonical.companion.d);
        if (evo && evo.length > 0) {
          content = serializeEvolutionContent(canonical.content, evo);
        }
      }

      // Get streak updates (will only update if needed based on day)
      const streakUpdates = getStreakTagUpdates(canonical.companion) ?? {};
      
      const petsTags = updatePetsTags(updatedTags, {
        ...statsUpdate,
        ...streakUpdates,
        last_interaction: nowStr,
        last_decay_at: nowStr,
      });

      const petsEvent = await publishEvent({
        kind: KIND_PETS_STATE,
        content,
        tags: petsTags,
        prev: canonical.companion.event,
      });

      updateCompanionEvent(petsEvent);

      // ─── Consume storage item only after the pet state event succeeds ───
      // This prevents losing the item if publishing the pet state fails.
      const consumeResult = await consumeStorageItem(nostr, publishEvent, user.pubkey, itemId);
      if (!consumeResult.consumed) {
        throw new Error(`You don't own ${shopItem.name}. Buy it in the shop first.`);
      }
      updateProfileEvent(consumeResult.event);

      // ─── Award the inventory action sats reward ───
      const satsReward = calculateInventoryActionReward(action, 1);
      let satsGained = 0;
      if (satsReward > 0 && user?.pubkey) {
        try {
          const satsResult = await addProfileSats(nostr, publishEvent, user.pubkey, satsReward);
          satsGained = satsResult.newSats;
          updateProfileEvent(satsResult.event);
        } catch (e) {
          console.error('Failed to award inventory sats reward:', e);
        }
      }

      // ─── Emit kind 1124 interaction event (best-effort, fire-and-forget) ───
      // ownerPubkey comes from the target Pets event, not the logged-in user,
      // so the tags remain correct if this path is later reused for non-owner interactions.
      const interactionAction = INTERNAL_TO_INTERACTION_ACTION[action];
      if (interactionAction) {
        emitInteractionEvent(publishEvent, {
          ownerPubkey: canonical.companion.event.pubkey,
          petsDTag: canonical.companion.d,
          action: interactionAction,
          source: interactionSource,
          itemId,
        });
      }

      // The 31124 canonical state is already updated above. Invalidate the
      // interactions query so the social projection picks up the new 1124.
      {
        const coordinate = `31124:${canonical.companion.event.pubkey}:${canonical.companion.d}`;
        queryClient.invalidateQueries({
          queryKey: ['pets-interactions', coordinate],
        });
      }

      return {
        itemName: shopItem.name,
        action,
        statsChanged,
        satsGained,
      };
    },
    onSuccess: ({ itemName, action, satsGained }) => {
      const actionMeta = ACTION_METADATA[action];
      const satsText = satsGained > 0 ? ` +${satsGained.toLocaleString()} sats` : '';
      toast({
        title: `${actionMeta.label} successful!`,
        description: `Used ${itemName} on your Pets.${satsText}`,
      });

      // Track daily mission progress
      trackInventoryDailyActions(action, user?.pubkey);
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to use item',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
