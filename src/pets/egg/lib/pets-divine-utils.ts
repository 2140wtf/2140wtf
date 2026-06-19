/**
 * Divine Pets Utilities
 *
 * This module provides centralized utilities for Divine theme detection and tag preservation
 * to ensure consistency across the entire application.
 */

import type { EggVisualPets } from '../types/egg.types';

/**
 * Divine theme constants
 */
export const DIVINE_THEME = 'divine';
export const DIVINE_CROSSOVER_APP = 'divine';
export const DIVINE_BASE_COLOR = '#55C4A2';
export const DIVINE_SPECIAL_MARK = 'divine_wordmark';

/**
 * Creates a tag map from tags array for efficient lookup
 */
export function createTagMap(tags: string[][] = []): Map<string, string> {
  const map = new Map<string, string>();
  tags.forEach(([key, value]) => {
    if (key && value) {
      map.set(key, value);
    }
  });
  return map;
}

/**
 * Robust Divine Pets detection
 * Checks both model fields and Nostr tags for comprehensive detection
 */
export function isDivinePets(pets: EggVisualPets | null | undefined): boolean {
  if (!pets) return false;

  // Check model fields
  if (pets.themeVariant === DIVINE_THEME) return true;
  if (pets.crossoverApp === DIVINE_CROSSOVER_APP) return true;

  // Check Nostr tags
  const tagMap = createTagMap(pets.tags);
  if (tagMap.get('theme') === DIVINE_THEME) return true;
  if (tagMap.get('crossover_app') === DIVINE_CROSSOVER_APP) return true;

  return false;
}

/**
 * Robust Divine egg detection (specialized for egg stage)
 */
export function isDivineEgg(pets: EggVisualPets | null | undefined): boolean {
  if (!pets || pets.lifeStage !== 'egg') return false;
  return isDivinePets(pets);
}

/**
 * Ensures Divine tags are present in a Pets's tags array
 * If Divine properties exist on the model but tags are missing, adds them
 */
export function ensureDivineTags(pets: EggVisualPets): EggVisualPets {
  const isDivine = isDivinePets(pets);
  if (!isDivine) return pets;

  const tagMap = createTagMap(pets.tags || []);
  const hasThemeTag = tagMap.get('theme') === DIVINE_THEME;
  const hasCrossoverTag = tagMap.get('crossover_app') === DIVINE_CROSSOVER_APP;

  // If Divine tags are missing, add them
  if (!hasThemeTag || !hasCrossoverTag) {
    const newTags = [...(pets.tags || [])];

    if (!hasThemeTag) {
      newTags.push(['theme', DIVINE_THEME]);
    }

    if (!hasCrossoverTag) {
      newTags.push(['crossover_app', DIVINE_CROSSOVER_APP]);
    }

    return {
      ...pets,
      tags: newTags,
    };
  }

  return pets;
}

/**
 * Synchronizes Divine model fields with tags
 * Ensures model fields reflect the tag values
 */
export function syncDivineModelFields(pets: EggVisualPets): EggVisualPets {
  const tagMap = createTagMap(pets.tags || []);
  const themeFromTag = tagMap.get('theme');
  const crossoverFromTag = tagMap.get('crossover_app');

  const hasDivineThemeTag = themeFromTag === DIVINE_THEME;
  const hasDivineCrossoverTag = crossoverFromTag === DIVINE_CROSSOVER_APP;

  // Only update if tags indicate Divine but model fields don't
  if (
    (hasDivineThemeTag || hasDivineCrossoverTag) &&
    !(pets.themeVariant === DIVINE_THEME || pets.crossoverApp === DIVINE_CROSSOVER_APP)
  ) {
    return {
      ...pets,
      themeVariant: hasDivineThemeTag ? DIVINE_THEME : pets.themeVariant,
      crossoverApp: hasDivineCrossoverTag ? DIVINE_CROSSOVER_APP : pets.crossoverApp,
    };
  }

  return pets;
}

/**
 * Ensures Divine properties are properly set when creating a Divine Pets
 */
export function createDivinePetsProperties(
  overrides: Partial<EggVisualPets> = {}
): Partial<EggVisualPets> {
  return {
    themeVariant: DIVINE_THEME,
    crossoverApp: DIVINE_CROSSOVER_APP,
    baseColor: DIVINE_BASE_COLOR,
    specialMark: DIVINE_SPECIAL_MARK,
    ...overrides,
  };
}

/**
 * Validates that Divine tags and model fields are in sync
 */
export function validateDivineConsistency(
  pets: EggVisualPets
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  const tagMap = createTagMap(pets.tags || []);
  const themeFromTag = tagMap.get('theme');
  const crossoverFromTag = tagMap.get('crossover_app');

  // Check consistency between model fields and tags
  if (pets.themeVariant === DIVINE_THEME && themeFromTag !== DIVINE_THEME) {
    errors.push('Model has themeVariant="divine" but tag is missing or different');
  }

  if (pets.crossoverApp === DIVINE_CROSSOVER_APP && crossoverFromTag !== DIVINE_CROSSOVER_APP) {
    errors.push('Model has crossoverApp="divine" but tag is missing or different');
  }

  if (themeFromTag === DIVINE_THEME && pets.themeVariant !== DIVINE_THEME) {
    errors.push('Tag has theme="divine" but model field is missing or different');
  }

  if (crossoverFromTag === DIVINE_CROSSOVER_APP && pets.crossoverApp !== DIVINE_CROSSOVER_APP) {
    errors.push('Tag has crossover_app="divine" but model field is missing or different');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
