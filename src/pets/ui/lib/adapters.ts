/**
 * Pets Data Adapters
 *
 * Adapter functions for converting various Pets data types
 * to the format expected by visual components.
 *
 * Previously duplicated in:
 * - PetsStageVisual.tsx (toPetsForVisual)
 * - PetsCompanionVisual.tsx (toBlobiForVisual - note typo)
 */

import type { Pets } from '@/pets/core/types/pets';
import type { PetsCompanion } from '@/pets/core/lib/pets';
import type { CompanionData } from '@/pets/companion/types/companion.types';

/**
 * Convert PetsCompanion to Pets type for visual rendering.
 *
 * This is a minimal adapter that extracts only the fields needed
 * by PetsBabyVisual and PetsAdultVisual.
 *
 * @param companion - PetsCompanion from parsePetsEvent
 * @returns Pets type for visual components
 */
export function petsCompanionToPets(companion: PetsCompanion): Pets {
  return {
    id: companion.d,
    name: companion.name,
    lifeStage: companion.stage,
    state: companion.state,
    isSleeping: companion.state === 'sleeping',
    stats: {
      hunger: companion.stats.hunger ?? 100,
      happiness: companion.stats.happiness ?? 100,
      health: companion.stats.health ?? 100,
      hygiene: companion.stats.hygiene ?? 100,
      energy: companion.stats.energy ?? 100,
    },
    // Visual traits
    baseColor: companion.visualTraits.baseColor,
    secondaryColor: companion.visualTraits.secondaryColor,
    eyeColor: companion.visualTraits.eyeColor,
    pattern: companion.visualTraits.pattern,
    specialMark: companion.visualTraits.specialMark,
    size: companion.visualTraits.size,
    archetype: companion.visualTraits.archetype,
    specialAbility: companion.visualTraits.specialAbility,
    // Metadata
    seed: companion.seed,
    tags: companion.allTags ?? [],
    // Adult-specific data (for adult form resolution)
    adult: companion.adultType ? { evolutionForm: companion.adultType } : undefined,
    // Breed category / asset so BAO card art and category form classes are preserved
    breedCategory: companion.breedCategory,
    breedAsset: companion.breedAsset,
  };
}

/**
 * Convert CompanionData to Pets type for visual rendering.
 *
 * CompanionData is the companion system's internal data type,
 * different from PetsCompanion used in the main app.
 *
 * @param companion - CompanionData from companion system
 * @returns Pets type for visual components
 */
export function companionDataToPets(companion: CompanionData): Pets {
  const isSleeping = companion.state === 'sleeping';
  return {
    id: companion.d,
    name: companion.name,
    lifeStage: companion.stage,
    state: companion.state ?? 'active',
    isSleeping,
    stats: {
      hunger: 100,
      happiness: 100,
      health: 100,
      hygiene: 100,
      energy: companion.energy,
    },
    baseColor: companion.visualTraits.baseColor,
    secondaryColor: companion.visualTraits.secondaryColor,
    eyeColor: companion.visualTraits.eyeColor,
    pattern: companion.visualTraits.pattern,
    specialMark: companion.visualTraits.specialMark,
    size: companion.visualTraits.size,
    archetype: companion.visualTraits.archetype,
    specialAbility: companion.visualTraits.specialAbility,
    seed: companion.seed ?? '',
    tags: [],
    // Include adult form info for proper rendering
    adult: companion.adultType ? { evolutionForm: companion.adultType } : undefined,
  };
}
