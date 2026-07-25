/**
 * Baby Pets SVG Resolver
 * 
 * Handles loading and resolving baby stage SVG assets
 */

import { Pets } from '@/pets/core/types/pets';
import { BabyVariant, BabySvgResolverOptions } from '../types/baby.types';
import { BABY_BASE_SVG, BABY_SLEEPING_SVG, BABY_2140_BASE_SVG, BABY_2140_SLEEPING_SVG } from './baby-svg-data';
import { getBaoRecipeById } from '@/pets/adult-pets/lib/bao-recipe';
import { generateBaoBabySvg } from '@/pets/adult-pets/lib/bao-svg';

/**
 * Get baby base SVG content
 */
export function getBabyBaseSvg(): string {
  return BABY_BASE_SVG;
}

/**
 * Get baby sleeping SVG content
 */
export function getBabySleepingSvg(): string {
  return BABY_SLEEPING_SVG;
}

/**
 * Get baby SVG by variant
 */
export function getBabySvgByVariant(variant: BabyVariant): string {
  return variant === 'sleeping' ? getBabySleepingSvg() : getBabyBaseSvg();
}

/**
 * Resolve baby Pets SVG content
 */
export function resolveBabySvg(pets: Pets, options: BabySvgResolverOptions = {}): string {
  const { isSleeping = false } = options;

  if (pets.lifeStage !== 'baby') {
    console.warn('resolveBabySvg called with non-baby Pets');
    return getFallbackBabySvg();
  }

  // 2140-pets get their own glassmorphism gangster baby design.
  if (pets.breedCategory === '2140-pets') {
    return isSleeping ? BABY_2140_SLEEPING_SVG : BABY_2140_BASE_SVG;
  }

  // ₿AO babies resemble their mature trading-card form: same creature, same
  // recipe palette, minus the rare back/aura accessories they grow into.
  if (pets.breedCategory === 'bao' && pets.breedAsset) {
    const baoRecipe = getBaoRecipeById(pets.breedAsset);
    if (baoRecipe) return generateBaoBabySvg(baoRecipe);
    // Unknown ₿AO asset → fall through to the generic baby.
  }

  return isSleeping ? getBabySleepingSvg() : getBabyBaseSvg();
}

/**
 * Preload baby SVGs for quick switching
 */
export function preloadBabySvgs(): void {
  // Both SVGs are inlined constants — this function exists for API consistency
  // This function exists for API consistency
  getBabyBaseSvg();
  getBabySleepingSvg();
}

/**
 * Get fallback baby SVG content
 */
function getFallbackBabySvg(): string {
  return `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="fallbackBodyGradient" cx="0.3" cy="0.25">
          <stop offset="0%" style="stop-color:#8b5cf6"/>
          <stop offset="60%" style="stop-color:#7c3aed"/>
          <stop offset="100%" style="stop-color:#6d28d9"/>
        </radialGradient>
      </defs>
      <path d="M 50 15 Q 50 10 50 15 Q 72 25 75 55 Q 75 80 50 88 Q 25 80 25 55 Q 28 25 50 15"
            fill="url(#fallbackBodyGradient)" />
      <ellipse cx="50" cy="45" rx="15" ry="20" fill="white" opacity="0.2" />
      <ellipse cx="38" cy="45" rx="8" ry="10" fill="#fff" />
      <ellipse cx="62" cy="45" rx="8" ry="10" fill="#fff" />
      <circle cx="38" cy="46" r="6" fill="#374151" />
      <circle cx="62" cy="46" r="6" fill="#374151" />
      <circle cx="40" cy="44" r="2" fill="white" />
      <circle cx="64" cy="44" r="2" fill="white" />
      <path d="M 42 62 Q 50 68 58 62" stroke="#374151" stroke-width="2.5" fill="none" stroke-linecap="round" />
    </svg>
  `;
}
