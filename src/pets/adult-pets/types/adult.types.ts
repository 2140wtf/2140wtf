/**
 * Adult Pets Module Types
 * 
 * Type definitions for adult stage visuals and customization
 */

import type { Pets } from '@/pets/core/types/pets';

/**
 * All available adult evolution forms.
 * Each form corresponds to a folder in assets/
 */
export const ADULT_FORMS = [
  'bloomi',
  'breezy',
  'cacti',
  'catti',
  'cloudi',
  'crysti',
  'droppi',
  'flammi',
  'froggi',
  'leafy',
  'mushie',
  'owli',
  'pandi',
  'rocky',
  'rosey',
  'starri',
  'glitchfox',
  'biomechmoth',
  'liquidblob',
  'honey-badger',
] as const;

export type AdultForm = typeof ADULT_FORMS[number];

/**
 * Adult visual variant types
 */
export type AdultVariant = 'base' | 'sleeping';

/**
 * Adult SVG customization options
 */
export interface AdultSvgCustomization {
  /** Base body color */
  baseColor?: string;
  /** Secondary body color */
  secondaryColor?: string;
  /** Eye/pupil color */
  eyeColor?: string;
}

/**
 * Adult SVG resolver options
 */
export interface AdultSvgResolverOptions {
  /** Whether the adult is sleeping */
  isSleeping?: boolean;
}

/**
 * Extracts adult-specific customization from a Pets
 */
export function extractAdultCustomization(pets: Pets): AdultSvgCustomization {
  return {
    baseColor: pets.baseColor,
    secondaryColor: pets.secondaryColor,
    eyeColor: pets.eyeColor,
  };
}

/**
 * Validates if a string is a valid adult form
 */
export function isValidAdultForm(form: string): form is AdultForm {
  return ADULT_FORMS.includes(form as AdultForm);
}

/**
 * Gets the default adult form (used as fallback)
 */
export function getDefaultAdultForm(): AdultForm {
  return 'catti';
}

/**
 * Resolves adult form from Pets data.
 * Uses adult.evolutionForm if set and valid, otherwise derives from seed.
 */
export function resolveAdultForm(pets: Pets): AdultForm {
  // Check explicit evolutionForm first
  if (pets.adult?.evolutionForm && isValidAdultForm(pets.adult.evolutionForm)) {
    return pets.adult.evolutionForm;
  }

  // Breed asset for adult-form categories is the chosen AdultForm; respect
  // it so category-constrained pets render the species the user selected
  // instead of falling back to a seed-derived form.
  if (pets.breedAsset && isValidAdultForm(pets.breedAsset)) {
    return pets.breedAsset;
  }

  // Derive from seed if available
  if (pets.seed) {
    return deriveAdultFormFromSeed(pets.seed);
  }

  // Fallback to default
  return getDefaultAdultForm();
}

/**
 * Derives adult form deterministically from a seed string.
 *
 * Uses the same seed-slice approach as all other visual-trait derivations
 * in pets.ts: reads 8 hex chars from offset [40..48] and maps to a
 * form index via modular arithmetic.
 *
 * This is the single canonical seed → adult form derivation. pets.ts
 * imports and delegates to this function for all adult-type resolution.
 */
export function deriveAdultFormFromSeed(seed: string): AdultForm {
  const slice = seed.slice(40, 48);
  const value = parseInt(slice, 16);
  if (Number.isNaN(value)) return getDefaultAdultForm();
  const index = value % ADULT_FORMS.length;
  return ADULT_FORMS[index];
}
