/**
 * Pets → EggGraphic Adapter
 * 
 * This module provides a translation layer between the Pets domain model
 * and the portable EggGraphic visual module.
 * 
 * PURPOSE:
 * - Keep the game/domain visual model decoupled from EggGraphic internals
 * - Provide explicit mappings between vocabularies
 * - Act as the single translation boundary for visual rendering
 * 
 * USAGE:
 * ```ts
 * const eggVisual = toEggGraphicVisualPets(companion);
 * // Pass eggVisual to EggGraphic component
 * ```
 */

import type { EggVisualPets } from '@/pets/egg';
import {
  type PetsCompanion,
  type PetsPattern,
  type PetsSpecialMark,
  type PetsStage,
  getTagValue,
} from './pets';

// ─── Egg Module Types (derived from EggVisualPets) ──────────────────────────

/** Life stage values accepted by EggGraphic */
type EggLifeStage = NonNullable<EggVisualPets['lifeStage']>;

/** Pattern values accepted by EggGraphic */
type EggPattern = NonNullable<EggVisualPets['pattern']>;

/** Special mark values accepted by EggGraphic */
type EggSpecialMark = NonNullable<EggVisualPets['specialMark']>;

/** Theme variant values accepted by EggGraphic */
type EggThemeVariant = NonNullable<EggVisualPets['themeVariant']>;

// ─── Mapping Tables ───────────────────────────────────────────────────────────

/**
 * Maps Pets pattern values to EggGraphic pattern values.
 * Explicit mapping allows vocabularies to diverge in the future.
 */
const PATTERN_MAP: Record<PetsPattern, EggPattern> = {
  'solid': 'solid',
  'spotted': 'spotted',
  'striped': 'striped',
  'gradient': 'gradient',
};

/**
 * Maps Pets special mark values to EggGraphic special mark values.
 */
const SPECIAL_MARK_MAP: Record<PetsSpecialMark, EggSpecialMark> = {
  'none': 'none',
  'star': 'star',
  'heart': 'heart',
  'sparkle': 'sparkle',
  'blush': 'blush',
};

/**
 * Maps Pets stage values to EggGraphic life stage values.
 */
const LIFE_STAGE_MAP: Record<PetsStage, EggLifeStage> = {
  'egg': 'egg',
  'baby': 'baby',
  'adult': 'adult',
};

// ─── Fallback Values ──────────────────────────────────────────────────────────

const DEFAULT_PATTERN: EggPattern = 'solid';
const DEFAULT_SPECIAL_MARK: EggSpecialMark = 'none';
const DEFAULT_LIFE_STAGE: EggLifeStage = 'egg';
const DEFAULT_THEME_VARIANT: EggThemeVariant = 'default';

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Extract crossover app identifier from companion tags.
 */
function extractCrossoverApp(allTags: string[][]): string | undefined {
  return getTagValue(allTags, 'crossover_app');
}

// ─── Main Adapter Function ────────────────────────────────────────────────────

/**
 * Convert a PetsCompanion to EggVisualPets for rendering.
 * 
 * This is the TRANSLATION BOUNDARY between the Pets domain model
 * and the EggGraphic visual module.
 * 
 * The adapter:
 * - Maps vocabulary values through explicit mapping tables
 * - Passes through full tags for EggGraphic metadata lookups
 * - Provides safe fallbacks for any missing/invalid data
 * - Does NOT leak app-specific assumptions into EggGraphic
 * 
 * @param companion - The parsed PetsCompanion from parsePetsEvent
 * @param themeVariant - Optional theme variant override
 * @returns Visual data compatible with EggVisualPets
 */
export function toEggGraphicVisualPets(
  companion: PetsCompanion,
  themeVariant: EggThemeVariant = DEFAULT_THEME_VARIANT
): EggVisualPets {
  const { visualTraits, stage, allTags = [] } = companion;
  
  return {
    // Colors pass through directly (already CSS hex values)
    baseColor: visualTraits.baseColor,
    secondaryColor: visualTraits.secondaryColor,
    
    // Mapped through explicit tables with fallbacks
    pattern: PATTERN_MAP[visualTraits.pattern] ?? DEFAULT_PATTERN,
    specialMark: SPECIAL_MARK_MAP[visualTraits.specialMark] ?? DEFAULT_SPECIAL_MARK,
    lifeStage: LIFE_STAGE_MAP[stage] ?? DEFAULT_LIFE_STAGE,
    
    // Theme variant
    themeVariant,

    // Pass through full tags for EggGraphic metadata lookups
    tags: allTags,

    // Optional visual scale (egg_size / egg_scale)
    scale: companion.eggScale ?? 1,

    // Extracted convenience values
    crossoverApp: extractCrossoverApp(allTags),
    
    // NOTE: We intentionally do NOT pass companion.name as title here.
    // The EggGraphic 'title' field is for special designations (e.g., "Divine"),
    // not the pet's name. The pet name is displayed separately by the parent component.
  };
}

/**
 * Check if two EggVisualPets configurations are visually equivalent.
 * Useful for memoization and avoiding unnecessary re-renders.
 */
export function areEggGraphicVisualsEqual(
  a: EggVisualPets,
  b: EggVisualPets
): boolean {
  return (
    a.baseColor === b.baseColor &&
    a.secondaryColor === b.secondaryColor &&
    a.pattern === b.pattern &&
    a.specialMark === b.specialMark &&
    a.lifeStage === b.lifeStage &&
    a.themeVariant === b.themeVariant &&
    a.scale === b.scale
  );
}
