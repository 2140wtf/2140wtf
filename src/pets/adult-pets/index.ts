/**
 * Adult Pets Module
 * 
 * Self-contained module for adult stage Pets visuals and customization.
 * This module includes:
 * - Adult SVG assets (awake and sleeping variants for each form)
 * - SVG resolution and loading utilities
 * - Color and customization utilities
 * - Type definitions
 * 
 * This module is designed to be portable and can be moved to other projects.
 */

// Types
export type { 
  AdultForm,
  AdultVariant,
  AdultSvgCustomization,
  AdultSvgResolverOptions,
} from './types/adult.types';

export {
  ADULT_FORMS,
  extractAdultCustomization,
  isValidAdultForm,
  getDefaultAdultForm,
  resolveAdultForm,
  deriveAdultFormFromSeed,
} from './types/adult.types';

// SVG Resolution
export {
  getAdultBaseSvg,
  getAdultSleepingSvg,
  getAdultSvgByVariant,
  resolveAdultSvg,
  resolveAdultSvgWithForm,
  getAvailableAdultForms,
  preloadAdultSvgs,
} from './lib/adult-svg-resolver';

// SVG Customization
export {
  customizeAdultSvg,
  customizeAdultSvgFromPets,
} from './lib/adult-svg-customizer';

// ₿AO Pets
export type {
  BaoRecipe,
  BaoRarity,
  BaoPalette,
  BaoAccessories,
} from './lib/bao-recipe';

export {
  BAO_RECIPE,
  getBaoRecipeById,
  getBaoRarityColor,
  compareBaoRarity,
} from './lib/bao-recipe';

export {
  generateBaoSvg,
  customizeBaoSvg,
} from './lib/bao-svg';
