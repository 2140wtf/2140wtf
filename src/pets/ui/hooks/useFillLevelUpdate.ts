/**
 * useFillLevelUpdate — Shared hook for SVG renderers to:
 *   1. Compute a structural recipe fingerprint that excludes angerRise.level
 *      (so level-only changes don't trigger full SVG rebuilds)
 *   2. Imperatively update gradient stops when level changes
 *      (preserves SMIL animations that dangerouslySetInnerHTML would kill)
 */

import { useMemo, useEffect, type RefObject } from 'react';

import type { PetsVisualRecipe } from '../lib/recipe';

/** Feather zone matching generateAngerRiseEffect() in generators.ts. */
const FEATHER = 0.10;

/**
 * Compute a stable fingerprint from a recipe that ignores angerRise.level.
 * Returns an empty string when recipe is null/undefined.
 */
export function useRecipeFingerprint(recipe: PetsVisualRecipe | undefined): string {
  return useMemo(() => {
    if (!recipe) return '';
    const { bodyEffects, ...rest } = recipe;
    if (!bodyEffects) return JSON.stringify(rest);
    const { angerRise, ...otherEffects } = bodyEffects;
    if (!angerRise) return JSON.stringify({ ...rest, bodyEffects: otherEffects });
    const { level: _level, ...stableAngerRise } = angerRise;
    return JSON.stringify({
      ...rest,
      bodyEffects: { ...otherEffects, angerRise: stableAngerRise },
    });
  }, [recipe]);
}

/**
 * Imperatively update the anger-rise gradient stops when only the level
 * changes, avoiding a full SVG rebuild.
 */
export function useFillLevelUpdate(
  containerRef: RefObject<HTMLDivElement | null>,
  petsId: string,
  recipe: PetsVisualRecipe | undefined,
): void {
  const fillLevel = recipe?.bodyEffects?.angerRise?.level;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || fillLevel === undefined) return;

    const gradientId = `pets-anger-gradient-${petsId}`;
    const gradient = container.querySelector(`#${CSS.escape(gradientId)}`);
    if (!gradient) return;

    const stops = gradient.querySelectorAll('stop');
    if (stops.length < 3) return;

    const edgeOffset = Math.max(0, fillLevel - FEATHER);
    stops[1]?.setAttribute('offset', String(edgeOffset));
    stops[2]?.setAttribute('offset', String(fillLevel));
  }, [fillLevel, petsId, containerRef]);
}
