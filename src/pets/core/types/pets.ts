// src/types/pets.ts

import type { PetsBreedCategory } from '@/pets/core/lib/pet-categories';

/**
 * Minimal, clean Pets domain types for the new project.
 *
 * Goal:
 * - keep the model small and portable
 * - support egg / baby / adult rendering
 * - support sleep state
 * - support visual customization
 * - avoid dragging old project complexity into the new app
 */

/* ────────────────────────────────────────────────────────────────────────── *
 * Core lifecycle / state
 * ────────────────────────────────────────────────────────────────────────── */

export type PetsLifeStage = 'egg' | 'baby' | 'adult';
export type PetsState = 'active' | 'sleeping' | 'hibernating';

/**
 * Progression process state — orthogonal to PetsState.
 */
export type PetsProgressionState = 'none' | 'incubating' | 'evolving';

/* ────────────────────────────────────────────────────────────────────────── *
 * Visual traits
 * ────────────────────────────────────────────────────────────────────────── */

export type PetsPattern = 'solid' | 'spotted' | 'striped' | 'gradient';
export type PetsSpecialMark = 'none' | 'star' | 'heart' | 'sparkle' | 'blush';
export type PetsSize = 'small' | 'medium' | 'large';
export type PetsArchetype = 'ghost' | 'runner' | 'netrunner' | 'drone' | 'construct' | 'cipher';
export type PetsSpecialAbility = 'glitch-step' | 'overclock' | 'firewall' | 'synesthesia' | 'recursion' | 'mirror-self';

export interface PetsVisualTraits {
  /**
   * Main body/base color.
   * Example: "#8B5CF6"
   */
  baseColor?: string;

  /**
   * Secondary/accent color, usually used in gradients or details.
   */
  secondaryColor?: string;

  /**
   * Eye / pupil color.
   */
  eyeColor?: string;

  /**
   * Optional pattern used by egg or future visual systems.
   */
  pattern?: PetsPattern;

  /**
   * Optional visual mark.
   */
  specialMark?: PetsSpecialMark;

  /**
   * Optional size hint for rendering.
   */
  size?: PetsSize;

  /**
   * Cypherpunk 2140 archetype class.
   */
  archetype?: PetsArchetype;

  /**
   * Cypherpunk 2140 special ability.
   */
  specialAbility?: PetsSpecialAbility;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Basic stats
 * Keep only what is useful right now for UI and simple interactions.
 * ────────────────────────────────────────────────────────────────────────── */

export interface PetsStats {
  hunger: number;
  happiness: number;
  health: number;
  hygiene: number;
  energy: number;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Stage-specific fields
 * ────────────────────────────────────────────────────────────────────────── */

export interface PetsEggData {
  incubationTime?: number;
  incubationProgress?: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PetsBabyData {
  // Reserved for future baby-specific fields
}

export interface PetsAdultData {
  evolutionForm?: string;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Main Pets entity
 * ────────────────────────────────────────────────────────────────────────── */

export interface Pets extends PetsVisualTraits {
  /**
   * Stable unique identifier.
   */
  id: string;

  /**
   * Display name.
   */
  name: string;

  /**
   * Current lifecycle stage.
   */
  lifeStage: PetsLifeStage;

  /**
   * Current activity state.
   */
  state: PetsState;

  /**
   * Optional convenience boolean for UI code that still expects this.
   * Prefer using `state === "sleeping"` in new code.
   */
  isSleeping?: boolean;

  /**
   * Basic gameplay / care stats.
   */
  stats: PetsStats;

  /**
   * Ownership / identity metadata.
   */
  ownerPubkey?: string;
  seed?: string;

  /**
   * Timestamps.
   * Keep them simple for now; decide later whether the project will
   * standardize on seconds or milliseconds everywhere.
   */
  createdAt?: number;
  birthTime?: number;
  hatchTime?: number;
  lastInteraction?: number;

  /**
   * Progression.
   */
  generation?: number;
  careStreak?: number;

  crossoverApp?: string | null;
  themeVariant?: string;

  /**
   * Breed category selected when the pet was minted.
   * Used to group pets in the Species tab and to pick the adult visual.
   */
  breedCategory?: PetsBreedCategory;

  /**
   * Category-specific asset identifier.
   * Adult-form category = the AdultForm name.
   * ₿AO category = the bao card id (e.g. "bao-05").
   */
  breedAsset?: string;

  /**
   * Optional raw tags for Nostr-backed or metadata-driven rendering.
   */
  tags?: string[][];

  /**
   * Optional stage-specific buckets.
   * This keeps the root model clean while leaving room to grow.
   */
  egg?: PetsEggData;
  baby?: PetsBabyData;
  adult?: PetsAdultData;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Defaults / helpers
 * ────────────────────────────────────────────────────────────────────────── */

export const DEFAULT_PETS_STATS: PetsStats = {
  hunger: 100,
  happiness: 100,
  health: 100,
  hygiene: 100,
  energy: 100,
};

export const DEFAULT_PETS_STATE: PetsState = 'active';
export const DEFAULT_PETS_LIFE_STAGE: PetsLifeStage = 'egg';

export function createDefaultPets(overrides: Partial<Pets> = {}): Pets {
  const state = overrides.state ?? DEFAULT_PETS_STATE;

  return {
    id: overrides.id ?? '2140pets-1',
    name: overrides.name ?? 'NOSTR PET',
    lifeStage: overrides.lifeStage ?? DEFAULT_PETS_LIFE_STAGE,
    state,
    isSleeping: overrides.isSleeping ?? state === 'sleeping',
    stats: overrides.stats ?? { ...DEFAULT_PETS_STATS },

    baseColor: overrides.baseColor,
    secondaryColor: overrides.secondaryColor,
    eyeColor: overrides.eyeColor,
    pattern: overrides.pattern,
    specialMark: overrides.specialMark,
    size: overrides.size,
    archetype: overrides.archetype,
    specialAbility: overrides.specialAbility,

    ownerPubkey: overrides.ownerPubkey,
    seed: overrides.seed,

    createdAt: overrides.createdAt,
    birthTime: overrides.birthTime,
    hatchTime: overrides.hatchTime,
    lastInteraction: overrides.lastInteraction,

    generation: overrides.generation ?? 1,
    careStreak: overrides.careStreak ?? 0,

    crossoverApp: overrides.crossoverApp ?? null,
    themeVariant: overrides.themeVariant,
    breedCategory: overrides.breedCategory,
    breedAsset: overrides.breedAsset,
    tags: overrides.tags ?? [],

    egg: overrides.egg,
    baby: overrides.baby,
    adult: overrides.adult,
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Type guards
 * ────────────────────────────────────────────────────────────────────────── */

export function isEggPets(pets: Pets): boolean {
  return pets.lifeStage === 'egg';
}

export function isBabyPets(pets: Pets): boolean {
  return pets.lifeStage === 'baby';
}

export function isAdultPets(pets: Pets): boolean {
  return pets.lifeStage === 'adult';
}

export function isPetsSleeping(pets: Pets): boolean {
  return pets.state === 'sleeping' || pets.isSleeping === true;
}