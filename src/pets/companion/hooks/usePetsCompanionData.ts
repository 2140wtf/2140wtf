/**
 * usePetsCompanionData Hook
 * 
 * Fetches the current companion data from the user's Nostr pet profile.
 * This is the data layer - it handles fetching and provides companion data.
 * 
 * Uses usePetssCollection with a targeted dList (single d-tag) for efficiency.
 * Optimistic updates from mutations propagate across all pets-collection
 * queries (including PetsPage's 'all' mode) via updateCompanionEvent.
 */

import { useMemo } from 'react';

import { useNostrPetProfile } from '@/hooks/useNostrPetProfile';
import { usePetssCollection } from '@/pets/core/hooks/usePetssCollection';
import { useProjectedPetsState } from '@/pets/core/hooks/useProjectedPetsState';
import type { CompanionData } from '../types/companion.types';

interface UsePetsCompanionDataResult {
  /** The current companion data, if available */
  companion: CompanionData | null;
  /** Whether the data is loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: Error | null;
}

/**
 * Hook to fetch the current companion from the user's Nostr pet profile.
 * 
 * Flow:
 * 1. Use useNostrPetProfile to get the profile (shared query, reactive)
 * 2. Build a dList containing just the currentCompanion (targeted fetch)
 * 3. Use usePetssCollection with the dList to get the companion
 * 4. Apply projected decay for accurate UI reactions
 * 5. Return the companion data with projected stats
 * 
 * Reactivity:
 * - Optimistic updates propagate across all pets-collection queries
 * - Projected decay recalculates every 60 seconds while mounted
 */
export function usePetsCompanionData(): UsePetsCompanionDataResult {
  // Use the shared profile hook - this ensures reactivity when profile changes
  const { profile, isLoading: profileLoading } = useNostrPetProfile();
  
  // Extract current companion d-tag from the reactive profile
  const currentCompanionD = profile?.currentCompanion;
  
  // Build dList containing just the current companion (if set)
  // This allows us to use the shared collection query cache
  const dList = useMemo(() => {
    if (!currentCompanionD) return undefined;
    return [currentCompanionD];
  }, [currentCompanionD]);
  
  // Use the shared collection query - same cache as PetsPage
  // This ensures we get optimistic updates immediately
  const {
    companionsByD,
    isLoading: collectionLoading,
  } = usePetssCollection(dList);
  
  // Get the PetsCompanion from the collection
  const pets = currentCompanionD ? companionsByD[currentCompanionD] ?? null : null;
  
  // Apply projected decay for accurate visual reactions.
  // Owner surfaces use decay-only — social effects are incorporated via
  // explicit consolidation, not pre-applied projection.
  // This recalculates every 60 seconds while mounted.
  const projectedState = useProjectedPetsState(pets);
  
  // Transform to CompanionData with projected stats
  // When currentCompanionD becomes null/undefined, companion becomes null
  const companion = useMemo((): CompanionData | null => {
    // If no current companion is set in profile, return null immediately
    // This ensures removal is reactive
    if (!currentCompanionD) return null;
    
    if (!pets) return null;
    
    // Use projected stats if available, otherwise fall back to base stats
    const stats = projectedState?.stats ?? pets.stats;
    
    return {
      d: pets.d,
      name: pets.name,
      stage: pets.stage,
      visualTraits: pets.visualTraits,
      energy: stats.energy ?? 100,
      stats: {
        hunger: stats.hunger ?? 100,
        happiness: stats.happiness ?? 100,
        health: stats.health ?? 100,
        hygiene: stats.hygiene ?? 100,
        energy: stats.energy ?? 100,
      },
      state: pets.state,
      // Include adult form info for proper rendering
      adultType: pets.adultType,
      seed: pets.seed,
    };
  }, [currentCompanionD, pets, projectedState?.stats]);
  
  return {
    companion,
    isLoading: profileLoading || (!!currentCompanionD && collectionLoading),
    error: null,
  };
}
