/**
 * Pets Visual System Library
 *
 * Centralized exports for the Pets visual system.
 *
 * Structure:
 * - types.ts: Shared type definitions
 * - constants.ts: Shared constants (timing, thresholds)
 * - adapters.ts: Data conversion utilities
 * - svg/: SVG manipulation utilities
 *   - colors.ts: Color manipulation
 *   - ids.ts: ID uniquification
 *   - container.ts: Container sizing
 *
 * Animation/rendering modules (not re-exported here):
 * - eye-animation.ts: SVG transformation for eye animation
 * - usePetsEyes.ts: Runtime eye animation hook
 * - useExternalEyeOffset.ts: External eye offset control
 * - recipe.ts: Part-based visual recipe system (core architecture)
 * - emotions.ts: Public API for emotion presets (delegates to recipe.ts)
 * - status-reactions.ts: Stats → recipe resolution (recipe-first pipeline)
 */

// Types
export * from './types';

// Constants
export * from './constants';

// Adapters
export { petsCompanionToPets, companionDataToPets } from './adapters';

// SVG utilities
export * from './svg';
