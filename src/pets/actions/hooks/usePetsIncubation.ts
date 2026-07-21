import { queryPetsRelay } from '@/pets/core/lib/pets-relay';
// src/pets/actions/hooks/usePetsIncubation.ts

/**
 * Hooks for Pets incubation task system.
 * 
 * When a user starts incubation:
 * 1. Apply accumulated decay from last_decay_at to now
 * 2. Set progression_state to 'incubating'
 * 3. Add progression_started_at timestamp
 * 4. Update last_decay_at to the same timestamp
 * 5. Clear any previous task progress
 * 
 * Tasks are computed from Nostr events with created_at >= progression_started_at
 */

import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';

import type { PetsCompanion, NostrPetProfile } from '@/pets/core/lib/pets';
import {
  KIND_PETS_STATE,
  updatePetsTags,
} from '@/pets/core/lib/pets';
import { applyPetsDecay, applyPetsDecayForCompanion } from '@/pets/core/lib/pets-decay';
import { useCurrentBlockHeight, isPetOldEnough, getStoredBirthBlockHeight } from '@/pets/core/lib/pets-life';
import { serializeEvolutionContent } from '@/pets/core/lib/missions';
import { createHatchMissions, createEvolveMissions } from '../lib/evolution-missions';
import {
  writeEvolutionToStorage,
  clearEvolutionFromStorage,
} from '../lib/daily-mission-tracker';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Mode for starting incubation.
 * This makes the intent explicit rather than auto-detecting behavior.
 */
export type StartIncubationMode = 
  | 'start'              // Normal start (no other Pets incubating)
  | 'restart'            // Restart same Pets (already incubating)
  | 'switch';            // Switch from another incubating Pets

/**
 * Request to start incubation with explicit mode.
 */
export interface StartIncubationRequest {
  /** Explicit mode for this operation */
  mode: StartIncubationMode;
  /** The d-tag of the other Pets to stop (required when mode === 'switch') */
  stopOtherD?: string;
}

/**
 * Parameters for start incubation hook.
 */
export interface UseStartIncubationParams {
  companion: PetsCompanion | null;
  profile: NostrPetProfile | null;
  /** Called to ensure companion is canonical (from migration helper) */
  ensureCanonicalBeforeAction: () => Promise<{
    companion: PetsCompanion;
    content: string;
    allTags: string[][];
    wasMigrated: boolean;
    profileAllTags: string[][];
    profileStorage: import('@/pets/core/lib/pets').StorageItem[];
  } | null>;
  /** Update companion event in local cache */
  updateCompanionEvent: (event: NostrEvent) => void;
}

/**
 * Result of starting incubation.
 */
export interface StartIncubationResult {
  /** The Pets's name */
  name: string;
  /** Timestamp when incubation started */
  progressionStartedAt: number;
  /** Mode that was used */
  mode: StartIncubationMode;
  /** Name of other Pets that was stopped (if mode === 'switch') */
  stoppedOtherName?: string;
}

// ─── Start Incubation Hook ────────────────────────────────────────────────────

/**
 * Hook to start the incubation process for an egg.
 * 
 * This sets progression_state to 'incubating' and records the start timestamp.
 * Tasks will be computed based on events created after this timestamp.
 * 
 * IMPORTANT: The mode must be explicitly specified by the caller (UI).
 * This hook does NOT auto-detect whether to switch or restart.
 * The UI dialog determines the mode and passes it explicitly.
 * 
 * Modes:
 * - 'start': Normal start, no other Pets incubating
 * - 'restart': Restart same Pets (already incubating), resets task progress
 * - 'switch': Stop another NOSTR PET first, then start this one
 * 
 * Requirements:
 * - Pets must be in egg stage
 * - User must be logged in
 */
export function useStartIncubation({
  companion,
  profile,
  ensureCanonicalBeforeAction,
  updateCompanionEvent,
}: UseStartIncubationParams) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const { config } = useAppContext();
  const currentBlockHeight = useCurrentBlockHeight(config.esploraApis);

  return useMutation({
    mutationFn: async (request: StartIncubationRequest): Promise<StartIncubationResult> => {
      const { mode, stopOtherD } = request;
      
      // ─── Validation ───
      if (!user?.pubkey) {
        throw new Error('You must be logged in to start incubation');
      }

      if (!companion) {
        throw new Error('No companion selected');
      }

      if (!profile) {
        throw new Error('Profile not found');
      }

      if (companion.stage !== 'egg') {
        throw new Error('Only eggs can be incubated');
      }

      // Eggs must wait for at least one real Bitcoin block before they can
      // start incubating. Prefer the stored birth_block tag; fall back to the
      // 10-minute estimate for legacy eggs.
      const storedBirthBlock = getStoredBirthBlockHeight(companion.event.tags);
      if (!isPetOldEnough(companion.event.created_at, currentBlockHeight, storedBirthBlock)) {
        throw new Error('This egg is still warming. Wait until at least one Bitcoin block is mined before hatching.');
      }

      // Validate switch mode requires stopOtherD
      if (mode === 'switch' && !stopOtherD) {
        throw new Error('Switch mode requires stopOtherD parameter');
      }

      let stoppedOtherName: string | undefined;

      // ─── Stop Other Incubating Pets (switch mode only) ───
      if (mode === 'switch' && stopOtherD) {
        // Fetch the current event for the other Pets
        const [otherEvent] = await queryPetsRelay(nostr, [{
          kinds: [KIND_PETS_STATE],
          authors: [user.pubkey],
          '#d': [stopOtherD],
          limit: 1,
        }]);
        
        if (otherEvent) {
          // Only stop the other pet if it is actually incubating.
          const progressionTag = otherEvent.tags.find((t) => t[0] === 'progression_state');
          const isIncubating = progressionTag?.[1] === 'incubating';

          if (isIncubating) {
            // Get name from the event for the result
            const nameTag = otherEvent.tags.find(t => t[0] === 'name');
            stoppedOtherName = nameTag?.[1] ?? stopOtherD;

            // Stop the other Pets's incubation
            const now = Math.floor(Date.now() / 1000);
            const nowStr = now.toString();

            // Parse stats from the event (defensive: malformed tag values fall back to defaults)
            const getNumericTag = (tags: string[][], name: string, fallback = 50): number => {
              const raw = tags.find(t => t[0] === name)?.[1];
              if (!raw) return fallback;
              const parsed = parseInt(raw, 10);
              return Number.isNaN(parsed) ? fallback : parsed;
            };

            const otherStats = {
              hunger: getNumericTag(otherEvent.tags, 'hunger'),
              happiness: getNumericTag(otherEvent.tags, 'happiness'),
              health: getNumericTag(otherEvent.tags, 'health'),
              hygiene: getNumericTag(otherEvent.tags, 'hygiene'),
              energy: getNumericTag(otherEvent.tags, 'energy'),
            };
            const otherLastDecayAt = getNumericTag(otherEvent.tags, 'last_decay_at', now);

            // Apply decay to the other Pets
            const otherDecayResult = applyPetsDecay({
              stage: 'egg',
              state: 'active',
              stats: otherStats,
              lastDecayAt: otherLastDecayAt,
              now,
            });

            // Remove task tags and progression timing from the other Pets
            const otherCleanedTags = otherEvent.tags.filter(tag =>
              tag[0] !== 'task' &&
              tag[0] !== 'task_completed' &&
              tag[0] !== 'state_started_at' &&
              tag[0] !== 'progression_started_at'
            );

            const otherNewTags = updatePetsTags(otherCleanedTags, {
              health: otherDecayResult.stats.health.toString(),
              hygiene: otherDecayResult.stats.hygiene.toString(),
              happiness: otherDecayResult.stats.happiness.toString(),
              hunger: '100',
              energy: '100',
              progression_state: 'none',
              last_interaction: nowStr,
              last_decay_at: nowStr,
            });

            // Clear evolution from the other Pets's content
            const otherContent = serializeEvolutionContent(otherEvent.content, []);

            // Publish the stop event for the other Pets
            const stopEvent = await publishEvent({
              kind: KIND_PETS_STATE,
              content: otherContent,
              tags: otherNewTags,
            });

            // Update the cache for the stopped Pets
            updateCompanionEvent(stopEvent);

            // Clear evolution session store for the stopped Pets
            clearEvolutionFromStorage(user.pubkey, stopOtherD);
          }
        }
      }

      // ─── Ensure Canonical Before Action ───
      const canonical = await ensureCanonicalBeforeAction();
      if (!canonical) {
        throw new Error('Failed to prepare companion for incubation');
      }

      // ─── Apply Accumulated Decay ───
      // CRITICAL: Apply decay from last_decay_at to now before changing state
      const now = Math.floor(Date.now() / 1000);
      const nowStr = now.toString();
      
      const decayResult = applyPetsDecayForCompanion(canonical.companion, now);
      
      // ─── Build Updated Tags ───
      // Remove any existing task tags when starting fresh (for all modes)
      const cleanedTags = canonical.allTags.filter(tag => 
        tag[0] !== 'task' && tag[0] !== 'task_completed'
      );
      
      // Build stats update with decayed values
      // Eggs have fixed hunger and energy at 100
      const statsUpdate: Record<string, string> = {
        health: decayResult.stats.health.toString(),
        hygiene: decayResult.stats.hygiene.toString(),
        happiness: decayResult.stats.happiness.toString(),
        hunger: '100',
        energy: '100',
      };
      
      const newTags = updatePetsTags(cleanedTags, {
        ...statsUpdate,
        progression_state: 'incubating',
        progression_started_at: nowStr,
        last_interaction: nowStr,
        last_decay_at: nowStr,
      });

      // ─── Build evolution content for 31124 ───
      const hatchMissions = createHatchMissions();
      const content = serializeEvolutionContent(canonical.content, hatchMissions);

      // ─── Publish Event ───
      const event = await publishEvent({
        kind: KIND_PETS_STATE,
        content,
        tags: newTags,
      });

      updateCompanionEvent(event);

      // ─── Populate evolution missions in session store (per-Pets) ───
      writeEvolutionToStorage(hatchMissions, user.pubkey, canonical.companion.d);
      window.dispatchEvent(new CustomEvent('daily-missions-updated', { detail: { evolution: true, d: canonical.companion.d } }));

      return {
        name: canonical.companion.name,
        progressionStartedAt: now,
        mode,
        stoppedOtherName,
      };
    },
    onSuccess: ({ name, mode, stoppedOtherName }) => {
      if (mode === 'switch' && stoppedOtherName) {
        toast({
          title: 'Switched incubation!',
          description: `Stopped ${stoppedOtherName}, now incubating ${name}.`,
        });
      } else if (mode === 'restart') {
        toast({
          title: 'Incubation restarted!',
          description: `${name}'s task progress has been reset.`,
        });
      } else {
        toast({
          title: 'Incubation started!',
          description: `${name} is now incubating. Complete the tasks to hatch!`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to start incubation',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ─── Stop Incubation Hook ─────────────────────────────────────────────────────

/**
 * Parameters for stop incubation hook.
 */
export interface UseStopIncubationParams {
  companion: PetsCompanion | null;
  /** Called to ensure companion is canonical (from migration helper) */
  ensureCanonicalBeforeAction: () => Promise<{
    companion: PetsCompanion;
    content: string;
    allTags: string[][];
    wasMigrated: boolean;
    profileAllTags: string[][];
    profileStorage: import('@/pets/core/lib/pets').StorageItem[];
  } | null>;
  /** Update companion event in local cache */
  updateCompanionEvent: (event: NostrEvent) => void;
}

/**
 * Result of stopping incubation.
 */
export interface StopIncubationResult {
  /** The Pets's name */
  name: string;
}

/**
 * Hook to stop/cancel the incubation process for a Pets.
 * 
 * This clears the progression process and all task progress tags.
 * The user can restart incubation later, but will need to complete tasks again.
 * 
 * When stopping incubation:
 * - Apply accumulated decay first
 * - Set progression_state back to 'none'
 * - Remove progression_started_at tag
 * - Remove all task and task_completed tags
 * 
 * Requirements:
 * - Pets must have progressionState === 'incubating'
 * - User must be logged in
 */
export function useStopIncubation({
  companion,
  ensureCanonicalBeforeAction,
  updateCompanionEvent,
}: UseStopIncubationParams) {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();

  return useMutation({
    mutationFn: async (): Promise<StopIncubationResult> => {
      // ─── Validation ───
      if (!user?.pubkey) {
        throw new Error('You must be logged in to stop incubation');
      }

      if (!companion) {
        throw new Error('No companion selected');
      }

      if (companion.progressionState !== 'incubating') {
        throw new Error('This NOSTR PET is not incubating');
      }

      // ─── Ensure Canonical Before Action ───
      const canonical = await ensureCanonicalBeforeAction();
      if (!canonical) {
        throw new Error('Failed to prepare companion');
      }

      // ─── Apply Accumulated Decay ───
      const now = Math.floor(Date.now() / 1000);
      const nowStr = now.toString();
      
      const decayResult = applyPetsDecayForCompanion(canonical.companion, now);
      
      // ─── Build Updated Tags ───
      // Remove task tags and progression timing
      const cleanedTags = canonical.allTags.filter(tag => 
        tag[0] !== 'task' && 
        tag[0] !== 'task_completed' && 
        tag[0] !== 'state_started_at' &&
        tag[0] !== 'progression_started_at'
      );
      
      // Build stats update with decayed values
      // Eggs have fixed hunger and energy at 100
      const statsUpdate: Record<string, string> = {
        health: decayResult.stats.health.toString(),
        hygiene: decayResult.stats.hygiene.toString(),
        happiness: decayResult.stats.happiness.toString(),
        hunger: '100',
        energy: '100',
      };
      
      const newTags = updatePetsTags(cleanedTags, {
        ...statsUpdate,
        progression_state: 'none',
        last_interaction: nowStr,
        last_decay_at: nowStr,
      });

      // ─── Clear evolution from 31124 content ───
      const content = serializeEvolutionContent(canonical.content, []);

      // ─── Publish Event ───
      const event = await publishEvent({
        kind: KIND_PETS_STATE,
        content,
        tags: newTags,
      });

      updateCompanionEvent(event);

      // ─── Clear evolution missions in session store ───
      clearEvolutionFromStorage(user.pubkey, canonical.companion.d);
      window.dispatchEvent(new CustomEvent('daily-missions-updated', { detail: { evolution: true, d: canonical.companion.d } }));

      return {
        name: canonical.companion.name,
      };
    },
  });
}

// ─── Start Evolution Hook ─────────────────────────────────────────────────────

/**
 * Parameters for start evolution hook.
 */
export interface UseStartEvolutionParams {
  companion: PetsCompanion | null;
  /** Called to ensure companion is canonical (from migration helper) */
  ensureCanonicalBeforeAction: () => Promise<{
    companion: PetsCompanion;
    content: string;
    allTags: string[][];
    wasMigrated: boolean;
    profileAllTags: string[][];
    profileStorage: import('@/pets/core/lib/pets').StorageItem[];
  } | null>;
  /** Update companion event in local cache */
  updateCompanionEvent: (event: NostrEvent) => void;
}

/**
 * Result of starting evolution.
 */
export interface StartEvolutionResult {
  /** The Pets's name */
  name: string;
  /** Timestamp when evolution started */
  progressionStartedAt: number;
}

/**
 * Hook to start the evolution process for a baby Pets.
 * 
 * This sets progression_state to 'evolving' and records the start timestamp.
 * Tasks will be computed based on events created after this timestamp.
 * 
 * Requirements:
 * - Pets must be in baby stage
 * - Pets must not already be evolving
 * - User must be logged in
 */
export function useStartEvolution({
  companion,
  ensureCanonicalBeforeAction,
  updateCompanionEvent,
}: UseStartEvolutionParams) {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();

  return useMutation({
    mutationFn: async (): Promise<StartEvolutionResult> => {
      // ─── Validation ───
      if (!user?.pubkey) {
        throw new Error('You must be logged in to start evolution');
      }

      if (!companion) {
        throw new Error('No companion selected');
      }

      if (companion.stage !== 'baby') {
        throw new Error('Only baby NOSTR PETS can evolve');
      }

      if (companion.progressionState === 'evolving') {
        throw new Error('This NOSTR PET is already evolving');
      }

      // ─── Ensure Canonical Before Action ───
      const canonical = await ensureCanonicalBeforeAction();
      if (!canonical) {
        throw new Error('Failed to prepare companion for evolution');
      }

      // ─── Apply Accumulated Decay ───
      const now = Math.floor(Date.now() / 1000);
      const nowStr = now.toString();
      
      const decayResult = applyPetsDecayForCompanion(canonical.companion, now);
      
      // ─── Build Updated Tags ───
      // Remove any existing task tags when starting fresh
      const cleanedTags = canonical.allTags.filter(tag => 
        tag[0] !== 'task' && tag[0] !== 'task_completed'
      );
      
      // Build stats update with decayed values
      const statsUpdate: Record<string, string> = {
        health: decayResult.stats.health.toString(),
        hygiene: decayResult.stats.hygiene.toString(),
        happiness: decayResult.stats.happiness.toString(),
        hunger: decayResult.stats.hunger.toString(),
        energy: decayResult.stats.energy.toString(),
      };
      
      const newTags = updatePetsTags(cleanedTags, {
        ...statsUpdate,
        progression_state: 'evolving',
        progression_started_at: nowStr,
        last_interaction: nowStr,
        last_decay_at: nowStr,
      });

      // ─── Build evolution content for 31124 ───
      const evolveMissions = createEvolveMissions();
      const content = serializeEvolutionContent(canonical.content, evolveMissions);

      // ─── Publish Event ───
      const event = await publishEvent({
        kind: KIND_PETS_STATE,
        content,
        tags: newTags,
      });

      updateCompanionEvent(event);

      // ─── Populate evolution missions in session store (per-Pets) ───
      writeEvolutionToStorage(evolveMissions, user.pubkey, canonical.companion.d);
      window.dispatchEvent(new CustomEvent('daily-missions-updated', { detail: { evolution: true, d: canonical.companion.d } }));

      return {
        name: canonical.companion.name,
        progressionStartedAt: now,
      };
    },
    onSuccess: ({ name }) => {
      toast({
        title: 'Evolution started!',
        description: `${name} is now working towards evolution. Complete the tasks to evolve!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to start evolution',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ─── Stop Evolution Hook ──────────────────────────────────────────────────────

/**
 * Parameters for stop evolution hook.
 */
export interface UseStopEvolutionParams {
  companion: PetsCompanion | null;
  /** Called to ensure companion is canonical (from migration helper) */
  ensureCanonicalBeforeAction: () => Promise<{
    companion: PetsCompanion;
    content: string;
    allTags: string[][];
    wasMigrated: boolean;
    profileAllTags: string[][];
    profileStorage: import('@/pets/core/lib/pets').StorageItem[];
  } | null>;
  /** Update companion event in local cache */
  updateCompanionEvent: (event: NostrEvent) => void;
}

/**
 * Result of stopping evolution.
 */
export interface StopEvolutionResult {
  /** The Pets's name */
  name: string;
}

/**
 * Hook to stop/cancel the evolution process for a Pets.
 * 
 * This clears the progression process and all task progress tags.
 * The user can restart evolution later, but will need to complete tasks again.
 * 
 * When stopping evolution:
 * - Apply accumulated decay first
 * - Set progression_state back to 'none'
 * - Remove progression_started_at tag
 * - Remove all task and task_completed tags
 * 
 * Requirements:
 * - Pets must have progressionState === 'evolving'
 * - User must be logged in
 */
export function useStopEvolution({
  companion,
  ensureCanonicalBeforeAction,
  updateCompanionEvent,
}: UseStopEvolutionParams) {
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();

  return useMutation({
    mutationFn: async (): Promise<StopEvolutionResult> => {
      // ─── Validation ───
      if (!user?.pubkey) {
        throw new Error('You must be logged in to stop evolution');
      }

      if (!companion) {
        throw new Error('No companion selected');
      }

      if (companion.progressionState !== 'evolving') {
        throw new Error('This NOSTR PET is not evolving');
      }

      // ─── Ensure Canonical Before Action ───
      const canonical = await ensureCanonicalBeforeAction();
      if (!canonical) {
        throw new Error('Failed to prepare companion');
      }

      // ─── Apply Accumulated Decay ───
      const now = Math.floor(Date.now() / 1000);
      const nowStr = now.toString();
      
      const decayResult = applyPetsDecayForCompanion(canonical.companion, now);
      
      // ─── Build Updated Tags ───
      // Remove task tags and progression timing
      const cleanedTags = canonical.allTags.filter(tag => 
        tag[0] !== 'task' && 
        tag[0] !== 'task_completed' && 
        tag[0] !== 'state_started_at' &&
        tag[0] !== 'progression_started_at'
      );
      
      // Build stats update with decayed values
      const statsUpdate: Record<string, string> = {
        health: decayResult.stats.health.toString(),
        hygiene: decayResult.stats.hygiene.toString(),
        happiness: decayResult.stats.happiness.toString(),
        hunger: decayResult.stats.hunger.toString(),
        energy: decayResult.stats.energy.toString(),
      };
      
      const newTags = updatePetsTags(cleanedTags, {
        ...statsUpdate,
        progression_state: 'none',
        last_interaction: nowStr,
        last_decay_at: nowStr,
      });

      // ─── Clear evolution from 31124 content ───
      const content = serializeEvolutionContent(canonical.content, []);

      // ─── Publish Event ───
      const event = await publishEvent({
        kind: KIND_PETS_STATE,
        content,
        tags: newTags,
      });

      updateCompanionEvent(event);

      // ─── Clear evolution missions in session store ───
      clearEvolutionFromStorage(user.pubkey, canonical.companion.d);
      window.dispatchEvent(new CustomEvent('daily-missions-updated', { detail: { evolution: true, d: canonical.companion.d } }));

      return {
        name: canonical.companion.name,
      };
    },
    onSuccess: ({ name }) => {
      toast({
        title: 'Evolution stopped',
        description: `${name} is no longer evolving. Task progress has been reset.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to stop evolution',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
