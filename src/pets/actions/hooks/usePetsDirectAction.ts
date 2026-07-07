// src/pets/actions/hooks/usePetsDirectAction.ts

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';

import type { PetsCompanion } from '@/pets/core/lib/pets';
import {
  KIND_PETS_STATE,
  updatePetsTags,
} from '@/pets/core/lib/pets';
import { applyPetsDecayForCompanion } from '@/pets/core/lib/pets-decay';
import { getEffectiveStatCap } from '@/pets/core/lib/category-abilities';
import {
  clampStat,
  applyStat,
  DIRECT_ACTION_METADATA,
  type DirectAction,
} from '../lib/pets-action-utils';
import { trackMultipleDailyMissionActions, trackEvolutionMissionTally, readEvolutionFromStorage } from '../lib/daily-mission-tracker';
import type { DailyMissionAction } from '../lib/daily-missions';
import { serializeEvolutionContent } from '@/pets/core/lib/missions';
import { getStreakTagUpdates } from '../lib/pets-streak';
import {
  calculateActionReward,
  formatSatsGain,
} from '../lib/pets-action-rewards';
import { addProfileSats } from '@/pets/core/lib/profile-sats';
import { INTERNAL_TO_INTERACTION_ACTION, emitInteractionEvent } from '@/pets/core/lib/pets-interaction';

// Import NostrEvent type
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Configuration for direct action happiness effects.
 * These are the happiness deltas for each direct action.
 */
export const DIRECT_ACTION_HAPPINESS_EFFECTS: Record<DirectAction, number> = {
  play_music: 15,
  sing: 20,
};

/**
 * Request payload for executing a direct action
 */
export interface DirectActionRequest {
  action: DirectAction;
}

/**
 * Result of executing a direct action
 */
export interface DirectActionResult {
  action: DirectAction;
  happinessChange: number;
  satsGained: number;
}

/**
 * Parameters for the usePetsDirectAction hook
 */
export interface UsePetsDirectActionParams {
  companion: PetsCompanion | null;
  /** Called after ensuring companion is canonical (from migration helper) */
  ensureCanonicalBeforeAction: () => Promise<{
    companion: PetsCompanion;
    content: string;
    allTags: string[][];
    wasMigrated: boolean;
  } | null>;
  /** Update companion event in local cache */
  updateCompanionEvent: (event: NostrEvent) => void;
  /** Update profile event in local cache */
  updateProfileEvent: (event: NostrEvent) => void;
  /** UI surface originating the interaction (used for kind 1124 source tag). Defaults to 'pets-page'. */
  interactionSource?: string;
}

/**
 * Hook to execute a direct action on a Pets companion.
 * Direct actions (play_music, sing) don't require selecting an item.
 * They directly affect happiness stat.
 * 
 * This hook:
 * 1. Validates the companion exists
 * 2. Ensures canonical format before action
 * 3. Applies accumulated decay
 * 4. Applies happiness boost
 * 5. Updates Pets state (kind 31124)
 * 6. Invalidates relevant queries
 */
export function usePetsDirectAction({
  companion,
  ensureCanonicalBeforeAction,
  updateCompanionEvent,
  updateProfileEvent,
  interactionSource = 'pets-page',
}: UsePetsDirectActionParams) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ action }: DirectActionRequest): Promise<DirectActionResult> => {
      // ─── Validation ───
      if (!user?.pubkey) {
        throw new Error('You must be logged in to perform actions');
      }

      if (!companion) {
        throw new Error('No companion selected');
      }

      // ─── Ensure Canonical Before Action ───
      const canonical = await ensureCanonicalBeforeAction();
      if (!canonical) {
        throw new Error('Failed to prepare companion for action');
      }

      // ─── Apply Accumulated Decay First ───
      // CRITICAL: Use canonical.companion for decay calculations, not the stale outer companion
      const now = Math.floor(Date.now() / 1000);
      const decayResult = applyPetsDecayForCompanion(canonical.companion, now);
      
      const statsAfterDecay = decayResult.stats;

      // Effective stat cap for this companion (category + rarity). Stored tags
      // remain clamped to 100 for backward compatibility; the effective cap is
      // used for effect calculations so direct actions can still grant sats when
      // stored stats are already at 100.
      const effectiveMax = getEffectiveStatCap(
        canonical.companion.breedCategory,
        canonical.companion.baoRarity,
      );
      
      // ─── Apply Happiness Effect ───
      const happinessDelta = DIRECT_ACTION_HAPPINESS_EFFECTS[action];
      const newHappiness = applyStat(statsAfterDecay.happiness, happinessDelta, effectiveMax);
      
      // Track if happiness actually changed (against effective cap, not storage clamp)
      const happinessChanged = newHappiness !== statsAfterDecay.happiness;
      
      // Build stats update
      const isEgg = canonical.companion.stage === 'egg';
      // Stored tags remain clamped to 100 for backward compatibility.
      const statsUpdate: Record<string, string> = {
        happiness: clampStat(newHappiness, 100).toString(),
        health: statsAfterDecay.health.toString(),
        hygiene: statsAfterDecay.hygiene.toString(),
      };
      
      if (isEgg) {
        // Eggs have fixed hunger and energy
        statsUpdate.hunger = '100';
        statsUpdate.energy = '100';
      } else {
        statsUpdate.hunger = clampStat(statsAfterDecay.hunger).toString();
        statsUpdate.energy = clampStat(statsAfterDecay.energy).toString();
      }

      // ─── Update Pets State Event (kind 31124) ───
      const nowStr = now.toString();
      
      // If incubating or evolving, increment the interaction counter in evolution missions
      const progressionState = canonical.companion.progressionState;
      const updatedTags = canonical.allTags;
      if (progressionState === 'incubating' || progressionState === 'evolving') {
        trackEvolutionMissionTally('interactions', 1, user.pubkey, canonical.companion.d);
      }
      
      // ─── Build content with latest evolution state ───
      // Read the updated evolution from session store so the publish carries
      // the latest progress, instead of relying on the debounce hook.
      let content = canonical.content;
      if (progressionState === 'incubating' || progressionState === 'evolving') {
        const evo = readEvolutionFromStorage(user.pubkey, canonical.companion.d);
        if (evo && evo.length > 0) {
          content = serializeEvolutionContent(canonical.content, evo);
        }
      }

      // Get streak updates (will only update if needed based on day)
      const streakUpdates = getStreakTagUpdates(canonical.companion) ?? {};
      
      // ─── Apply sats reward (ONLY if happiness actually changed) ───
      // Direct actions modify happiness. Only grant sats if happiness actually increased.
      const satsGained = happinessChanged ? calculateActionReward(action) : 0;

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
        });

        // Invalidate interactions query so the social projection picks up
        // the new 1124 event. The 1124 publish is fire-and-forget, so the
        // relay may not have it yet — but the 31124 was already updated
        // above, so the owner's UI is already correct via canonical state.
        // This invalidation ensures eventual consistency for the projection.
        const coordinate = `31124:${canonical.companion.event.pubkey}:${canonical.companion.d}`;
        queryClient.invalidateQueries({
          queryKey: ['pets-interactions', coordinate],
        });
      }

      // Award sats to the player's profile. The pet event is already committed,
      // so a profile-sats failure must not report the whole action as failed.
      let profileEvent: NostrEvent | undefined;
      if (satsGained > 0 && user?.pubkey) {
        try {
          const result = await addProfileSats(nostr, publishEvent, user.pubkey, satsGained);
          profileEvent = result.event;
          updateProfileEvent(profileEvent);
        } catch (error) {
          console.error('[usePetsDirectAction] Failed to add sats:', error);
        }
      }

      return {
        action,
        happinessChange: happinessDelta,
        satsGained: profileEvent ? satsGained : 0,
      };
    },
    onSuccess: ({ action, happinessChange, satsGained }) => {
      const actionMeta = DIRECT_ACTION_METADATA[action];
      const satsText = formatSatsGain(satsGained);
      toast({
        title: `${actionMeta.label} complete!`,
        description: `Your NOSTR PET's happiness increased by ${happinessChange}! ${satsText}`,
      });

      // Track daily mission progress
      // 'interact' is always tracked, plus the specific action
      const dailyActions: DailyMissionAction[] = ['interact'];
      if (action === 'sing') dailyActions.push('sing');
      if (action === 'play_music') dailyActions.push('play_music');
      trackMultipleDailyMissionActions(dailyActions, user?.pubkey);
    },
    onError: (error: Error) => {
      toast({
        title: 'Action failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
