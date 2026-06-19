/**
 * PetsBabySvgRenderer — Pure SVG rendering component for baby Pets.
 *
 * This component is the leaf node of the visual pipeline. It:
 *   1. Resolves the base SVG for the baby
 *   2. Customizes colors and unique IDs
 *   3. Adds eye animation infrastructure (blink clip-paths, gaze groups)
 *   4. Applies visual recipe or emotion preset
 *   5. Applies manual body effects (when no recipe is provided)
 *   6. Sanitizes the SVG
 *   7. Renders via dangerouslySetInnerHTML
 *
 * It does NOT know about:
 *   - Eye tracking hooks (usePetsEyes / useExternalEyeOffset)
 *   - Render mode (page vs companion)
 *   - Reaction CSS classes (sway / bounce)
 *   - Companion runtime (drag, float, position)
 */

import { useMemo } from 'react';

import { resolveBabySvg, customizeBabySvgFromPets } from '@/pets/baby-pets';
import { sanitizePetsSvg } from '@/lib/sanitizePetsSvg';

import { addEyeAnimation } from './lib/eye-animation';
import { resolveVisualRecipe, applyVisualRecipe, type PetsVisualRecipe } from './lib/recipe';
import type { PetsEmotion } from './lib/emotion-types';
import { applyBodyEffects, type BodyEffectsSpec } from './lib/bodyEffects';
import { debugPets } from './lib/debug';
import { useRecipeFingerprint } from './hooks/useFillLevelUpdate';
import { usePetsInstanceId } from './hooks/usePetsInstanceId';
import type { Pets } from '@/pets/core/types/pets';

export interface PetsBabySvgRendererProps {
  /** The Pets data */
  pets: Pets;
  /** Whether the Pets is sleeping */
  isSleeping: boolean;
  /** Pre-resolved visual recipe. Takes precedence over `emotion`. */
  recipe?: PetsVisualRecipe;
  /** Label for the recipe (used in CSS class names). */
  recipeLabel?: string;
  /** Named emotion preset. Ignored when `recipe` is provided. Default: 'neutral' */
  emotion?: PetsEmotion;
  /** Body-level visual effects (manual/external use only — not from status reaction). */
  bodyEffects?: BodyEffectsSpec;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * Pure SVG renderer for baby Pets.
 *
 * IMPORTANT: This component must remain a pure rendering leaf. It must NOT:
 * - Run eye-tracking hooks (those belong in the Visual wrapper)
 * - Know about render modes or companion runtime
 * - Apply reaction CSS classes (those belong on an outer wrapper)
 *
 * The parent Visual wrapper owns the DOM query boundary (containerRef)
 * that eye hooks use to find SVG elements via querySelector.
 */
export function PetsBabySvgRenderer({
  pets,
  isSleeping: _isSleeping,
  recipe: recipeProp,
  recipeLabel,
  emotion = 'neutral',
  bodyEffects,
  className,
}: PetsBabySvgRendererProps) {
  const recipeFingerprint = useRecipeFingerprint(recipeProp);

  const instanceId = usePetsInstanceId(pets.id);

  const customizedSvg = useMemo(() => {
    debugPets('svg-rebuild', 'baby customizedSvg rebuild');

    // Always use the base (awake) SVG — sleeping is a recipe overlay, not an asset swap
    const baseSvg = resolveBabySvg(pets, { isSleeping: false });
    const colorizedSvg = customizeBabySvgFromPets(baseSvg, pets, false);

    let animatedSvg = addEyeAnimation(colorizedSvg, { baseColor: pets.baseColor, instanceId });

    if (recipeProp) {
      animatedSvg = applyVisualRecipe(animatedSvg, recipeProp, recipeLabel ?? 'status', 'baby', undefined, instanceId);
    } else if (emotion !== 'neutral') {
      const resolved = resolveVisualRecipe(emotion);
      animatedSvg = applyVisualRecipe(animatedSvg, resolved, emotion, 'baby', undefined, instanceId);
    }

    if (bodyEffects && !recipeProp) {
      animatedSvg = applyBodyEffects(animatedSvg, { ...bodyEffects, idPrefix: bodyEffects.idPrefix ?? instanceId });
    }

    return animatedSvg;
  // Deps use stable primitives from pets (not the object reference) and
  // recipeFingerprint (not recipeProp) so that level-only changes and
  // upstream reference churn do NOT trigger full SVG rebuilds. The closure
  // captures the current pets/recipeProp for the rare structural rebuilds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pets.id, pets.baseColor, pets.secondaryColor, pets.eyeColor, pets.seed, instanceId, recipeFingerprint, recipeLabel, emotion, bodyEffects]);

  const safeSvg = useMemo(() => sanitizePetsSvg(customizedSvg), [customizedSvg]);

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: safeSvg }}
    />
  );
}
