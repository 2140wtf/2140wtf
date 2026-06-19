/**
 * Baby Pets Module Types
 * 
 * Type definitions for baby stage visuals and customization
 */

import { Pets } from '@/pets/core/types/pets';

/**
 * Baby visual variant types
 */
export type BabyVariant = 'base' | 'sleeping';

/**
 * Baby SVG customization options
 */
export interface BabySvgCustomization {
  /** Base body color */
  baseColor?: string;
  /** Secondary body color (for gradient) */
  secondaryColor?: string;
  /** Eye/pupil color */
  eyeColor?: string;
}

/**
 * Baby SVG resolver options
 */
export interface BabySvgResolverOptions {
  /** Whether the baby is sleeping */
  isSleeping?: boolean;
  /** Apply color customizations */
  applyColors?: boolean;
}

/**
 * Extracts baby-specific customization from a Pets
 */
export function extractBabyCustomization(pets: Pets): BabySvgCustomization {
  return {
    baseColor: pets.baseColor,
    secondaryColor: pets.secondaryColor,
    eyeColor: pets.eyeColor,
  };
}
