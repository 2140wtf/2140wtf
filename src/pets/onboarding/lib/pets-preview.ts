/**
 * Pets Preview Generation Utilities
 * 
 * This module provides utilities for generating egg previews during onboarding.
 * The preview is the source of truth for the final adopted event - no regeneration
 * should occur when adopting.
 */

import {
  DEFAULT_EGG_STATS,
  PETS_ECOSYSTEM_NAMESPACE,
  deriveVisualTraits,
  derivePetsSeedV1,
  generatePetId10,
  getCanonicalPetsD,
  getLocalDayString,
  adjustSeedForAdultType,
  getBaoRarityFromAsset,
  type PetsVisualTraits,
  type PetsStats,
} from '@/pets/core/lib/pets';

import {
  getRandomCategoryMember,
  getMemberAssetId,
  isAdultFormMember,
  type PetsBreedCategory,
} from '@/pets/core/lib/pet-categories';
import { deriveAdultFormFromSeed } from '@/pets/adult-pets/types/adult.types';
import { BIRTH_BLOCK_TAG } from '@/pets/core/lib/pets-life';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Complete preview data for a Pets egg before adoption.
 * This is the source of truth - the same data is used to build the final event.
 */
export interface PetsEggPreview {
  /** Random 10-char hex petId */
  petId: string;
  /** Canonical d-tag: pets-{pubkeyPrefix12}-{petId10} */
  d: string;
  /** 64-char hex seed for deterministic visual traits */
  seed: string;
  /** Display name for the egg (default: 'Egg') */
  name: string;
  /** Life stage - always 'egg' for previews */
  stage: 'egg';
  /** Activity state */
  state: 'active';
  /** Progression state - new eggs start incubating; older eggs may be 'none' */
  progressionState: 'incubating' | 'none';
  /** Visual traits derived from seed */
  visualTraits: PetsVisualTraits;
  /** Default stats for a new egg */
  stats: PetsStats;
  /** Unix timestamp when preview was created (used for seed derivation) */
  createdAt: number;
  /** Owner pubkey */
  ownerPubkey: string;
  /** Breed category selected for this egg (optional). */
  breedCategory?: PetsBreedCategory;
  /** Category-specific asset identifier. */
  breedAsset?: string;
}

// ─── Generation ───────────────────────────────────────────────────────────────

/**
 * Generate a new egg preview with all data needed for adoption.
 * 
 * This function creates a complete preview that can be:
 * 1. Rendered in the UI using the existing visual system
 * 2. Converted directly to event tags for publishing (without regeneration)
 * 
 * @param pubkey - The owner's pubkey
 * @param name - Optional name for the egg (default: 'Egg')
 * @returns Complete preview data
 */
export function generateEggPreview(
  pubkey: string,
  name = 'Egg'
): PetsEggPreview {
  const petId = generatePetId10();
  const d = getCanonicalPetsD(pubkey, petId);
  const createdAt = Math.floor(Date.now() / 1000);
  const seed = derivePetsSeedV1(pubkey, d, createdAt);
  
  // Derive visual traits from seed (same as parsePetsEvent does)
  // Pass empty tags since this is a new preview with no existing tags
  const visualTraits = deriveVisualTraits([], seed);
  
  return {
    petId,
    d,
    seed,
    name,
    stage: 'egg',
    state: 'active',
    progressionState: 'incubating',
    visualTraits,
    stats: { ...DEFAULT_EGG_STATS },
    createdAt,
    ownerPubkey: pubkey,
  };
}

/**
 * Generate an egg preview constrained to a specific breed category.
 *
 * - For adult-form categories (NOSTR Pets / Blobbi) the seed is adjusted
 *   so the pet deterministically evolves into a random form from that category.
 * - For the ₿AO category a random collectible card id is stored as breedAsset;
 *   the adult visual will render the card image instead of an SVG form.
 */
export function generateEggPreviewForCategory(
  pubkey: string,
  category: PetsBreedCategory,
  name = 'Egg'
): PetsEggPreview {
  const member = getRandomCategoryMember(category);
  const base = generateEggPreview(pubkey, name);

  if (isAdultFormMember(member)) {
    const adjustedSeed = adjustSeedForAdultType(base.seed, member.form);
    return {
      ...base,
      seed: adjustedSeed,
      visualTraits: deriveVisualTraits([], adjustedSeed),
      breedCategory: category,
      breedAsset: member.form,
    };
  }

  return {
    ...base,
    breedCategory: category,
    breedAsset: getMemberAssetId(member),
  };
}

// ─── Update Preview ───────────────────────────────────────────────────────────

/**
 * Update the name in an existing preview.
 * Returns a new preview object with the updated name.
 * All other data (petId, d, seed, visualTraits) remains unchanged.
 * 
 * Note: This allows empty names during editing. Validation should be done
 * at the UI level (disable adopt button) or on submit, not here.
 */
export function updatePreviewName(
  preview: PetsEggPreview,
  name: string
): PetsEggPreview {
  return {
    ...preview,
    name, // Allow empty during editing - validate on submit
  };
}

// ─── Conversion ───────────────────────────────────────────────────────────────

/**
 * Convert a preview to event tags for publishing.
 * 
 * CRITICAL: This uses the exact preview data - no regeneration occurs.
 * The preview is the source of truth for the final adopted event.
 * 
 * Includes all visual trait tags to ensure deterministic rendering.
 * While these can be derived from the seed, including them explicitly:
 * 1. Makes the event self-describing
 * 2. Enables relay-level filtering by visual traits
 * 3. Ensures consistent rendering even if derivation logic changes
 * 
 * @param preview - The preview to convert
 * @returns Tags array for Kind 31124 event
 */
export function previewToEventTags(preview: PetsEggPreview, birthBlockHeight?: number): string[][] {
  const now = preview.createdAt.toString();
  const { visualTraits } = preview;

  return [
    ['d', preview.d],
    ['b', PETS_ECOSYSTEM_NAMESPACE],
    ...(birthBlockHeight !== undefined ? [[BIRTH_BLOCK_TAG, birthBlockHeight.toString()]] : []),
    ['name', preview.name],
    ['stage', preview.stage],
    ['state', preview.state],
    ['progression_state', preview.progressionState],
    ['seed', preview.seed],
    ['generation', '1'],
    ['breeding_ready', 'false'],
    ['care_streak', '1'],
    ['care_streak_last_at', now],
    ['care_streak_last_day', getLocalDayString(new Date(preview.createdAt * 1000))],
    ['hunger', preview.stats.hunger.toString()],
    ['happiness', preview.stats.happiness.toString()],
    ['health', preview.stats.health.toString()],
    ['hygiene', preview.stats.hygiene.toString()],
    ['energy', preview.stats.energy.toString()],
    ['last_interaction', now],
    ['last_decay_at', now],
    ['progression_started_at', now],
    // Pet-bound fiat balance and egg scale
    ['fiat_balance', '2140'],
    ['egg_scale', '1'],
    // Visual trait tags - ensures deterministic rendering
    ['base_color', visualTraits.baseColor],
    ['secondary_color', visualTraits.secondaryColor],
    ['eye_color', visualTraits.eyeColor],
    ['pattern', visualTraits.pattern],
    ['special_mark', visualTraits.specialMark],
    ['size', visualTraits.size],
    ['archetype', visualTraits.archetype],
    ['special_ability', visualTraits.specialAbility],
    ...(preview.breedCategory ? [['breed_category', preview.breedCategory]] : []),
    ...(preview.breedAsset ? [['breed_asset', preview.breedAsset]] : []),
    // Lock in the selected adult form for SVG-form categories so the pet
    // always evolves into the category member the user chose, even if the
    // seed-adjustment path is bypassed or overwritten later. ₿AO (cards) and
    // Buzz (animated characters) render from breed_asset instead, so no
    // SVG adult form is locked for them.
    ...(preview.breedCategory && preview.breedCategory !== 'bao' && preview.breedCategory !== 'buzz' && preview.seed
      ? [['adult_type', deriveAdultFormFromSeed(preview.seed)]]
      : []),
    ...(preview.breedCategory === 'bao' && preview.breedAsset
      ? [['bao_rarity', getBaoRarityFromAsset(preview.breedAsset) ?? 'common']]
      : []),
  ];
}

// ─── Adapter for Visual Components ────────────────────────────────────────────

/**
 * Convert a preview to a minimal PetsCompanion-like object for rendering.
 * This allows the existing PetsStageVisual/PetsEggVisual to render the preview.
 */
export function previewToPetsCompanion(preview: PetsEggPreview) {
  // Create a minimal object that matches what PetsStageVisual needs
  return {
    // Required fields for PetsStageVisual
    d: preview.d,
    name: preview.name,
    stage: preview.stage,
    state: preview.state,
    seed: preview.seed,
    visualTraits: preview.visualTraits,
    stats: preview.stats,
    
    // Required but not used for preview rendering
    isLegacy: false,
    needsSeedIdentitySync: false,
    lastInteraction: preview.createdAt,
    lastDecayAt: preview.createdAt,
    generation: 1,
    breedingReady: false,
    socialOpen: false,
    careStreak: 1,
    careStreakLastAt: preview.createdAt,
    careStreakLastDay: getLocalDayString(new Date(preview.createdAt * 1000)),
    incubationTime: undefined, // Deprecated field, no longer used
    startIncubation: undefined, // Deprecated field, no longer used
    adultType: undefined, // Eggs don't have adult type
    customFormId: preview.breedCategory === 'custom' ? preview.breedAsset : undefined,
    breedCategory: preview.breedCategory,
    breedAsset: preview.breedAsset,
    fiatBalance: 2_140,
    eggScale: 1,
    
    // Task-related fields
    progressionState: preview.progressionState,
    stateStartedAt: preview.createdAt,
    progressionStartedAt: preview.createdAt,
    tasks: [],
    tasksCompleted: [],
    evolution: [],
    
    // We need allTags for the adapter, but preview has no extra tags
    allTags: previewToEventTags(preview),
    
    // Event placeholder - not needed for preview rendering
    event: {
      id: '',
      pubkey: preview.ownerPubkey,
      created_at: preview.createdAt,
      kind: 31124,
      tags: previewToEventTags(preview),
      content: '',
      sig: '',
    },
  };
}
