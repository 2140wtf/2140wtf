/**
 * PetsAdultVisual — Visual wrapper for rendering Pets adults.
 *
 * Responsibilities:
 *   - Owns the container ref for eye hooks to query SVG DOM
 *   - Runs usePetsEyes (blink RAF loop, optional mouse tracking)
 *   - Runs useExternalEyeOffset (companion gaze RAF loop)
 *   - Applies reaction CSS classes (sway/bounce) in page mode
 *   - Delegates SVG rendering to PetsAdultSvgRenderer
 *
 * The SVG renderer is a separate component so the dangerouslySetInnerHTML
 * node stays mounted even when wrapper-level props change (reaction,
 * className toggles, etc.).
 *
 * Render modes:
 *   - 'page' (default): Mouse tracking enabled, reaction classes applied here.
 *   - 'companion': Mouse tracking disabled (gaze via ref), reaction classes
 *     suppressed (applied by outer companion wrapper instead).
 */

import { useRef, type RefObject } from 'react';

import { cn } from '@/lib/utils';

import { usePetsEyes, type PetsLookMode } from './lib/usePetsEyes';
import { useExternalEyeOffset } from './lib/useExternalEyeOffset';
import type { ExternalEyeOffset, PetsReactionState, PetsRenderMode } from './lib/types';
import type { PetsVisualRecipe } from './lib/recipe';
import type { PetsEmotion } from './lib/emotion-types';
import type { BodyEffectsSpec } from './lib/bodyEffects';
import type { PetsFacing } from './hooks/usePetsDirectInteraction';
import type { Pets } from '@/pets/core/types/pets';
import { isPetsSleeping } from '@/pets/core/types/pets';
import { PetsAdultSvgRenderer } from './PetsAdultSvgRenderer';
import { resolveAdultForm } from '@/pets/adult-pets';
import { getBaoRecipeById } from '@/pets/adult-pets/lib/bao-recipe';
import type { CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';

export interface PetsAdultVisualProps {
  /** The Pets data */
  pets: Pets;
  /** Reaction state for music/sing animations */
  reaction?: PetsReactionState;
  /** Controls eye tracking behavior (default: 'follow-pointer') */
  lookMode?: PetsLookMode;
  /** Disable blinking animation (for photo/export mode) */
  disableBlink?: boolean;
  /** External eye offset (value-based — causes rerenders). */
  externalEyeOffset?: ExternalEyeOffset;
  /** Ref-based external eye offset (imperative — no rerenders). Preferred for companion mode. */
  externalEyeOffsetRef?: RefObject<ExternalEyeOffset>;
  /** Render mode. Default: 'page'. */
  renderMode?: PetsRenderMode;
  /** Pre-resolved visual recipe. Takes precedence over `emotion`. */
  recipe?: PetsVisualRecipe;
  /** Label for the recipe (used in CSS class names). */
  recipeLabel?: string;
  /** Named emotion preset. Ignored when `recipe` is provided. Default: 'neutral' */
  emotion?: PetsEmotion;
  /** Body-level visual effects (manual/external use only). */
  bodyEffects?: BodyEffectsSpec;
  /** Horizontal facing direction. `left` mirrors the visual with scaleX(-1). */
  facing?: PetsFacing;
  /** Optional owner custom species map. If omitted, the current user's profile is used. */
  customForms?: Record<string, CustomPetForm>;
  /** Additional CSS classes for the container */
  className?: string;
}

export function PetsAdultVisual({
  pets,
  reaction = 'idle',
  lookMode = 'follow-pointer',
  disableBlink = false,
  externalEyeOffset,
  externalEyeOffsetRef,
  renderMode = 'page',
  recipe,
  recipeLabel,
  emotion = 'neutral',
  bodyEffects,
  facing,
  customForms,
  className,
}: PetsAdultVisualProps) {
  const isSleeping = isPetsSleeping(pets);

  // This ref is the DOM query boundary for eye hooks. usePetsEyes and
  // useExternalEyeOffset use querySelector on this element to find SVG
  // eye elements rendered by the child SvgRenderer.
  const containerRef = useRef<HTMLDivElement>(null);

  const isCompanion = renderMode === 'companion';

  const effectiveReaction = isSleeping ? 'idle' : reaction;
  const isFacingLeft = facing === 'left';
  // Eye tracking follows the pointer only when facing forward; mirrored SVG
  // would make the computed gaze direction look inverted.
  const effectiveLookMode = isFacingLeft ? 'forward' : lookMode;

  // ── State + form classes for species-specific CSS animations ───────────────

  const baoRecipe = pets.breedAsset ? getBaoRecipeById(pets.breedAsset) : undefined;
  const formClass =
    pets.breedCategory === 'custom' && pets.breedAsset
      ? `pets-form-custom-${pets.breedAsset}`
      : baoRecipe
        ? `pets-bao-${pets.breedAsset}`
        : `pets-form-${resolveAdultForm(pets)}`;

  const stateClass = isSleeping
    ? 'pets-state-sleeping'
    : `pets-state-${effectiveReaction === 'swaying' ? 'listening' : effectiveReaction}`;

  // ── Eye hooks ──────────────────────────────────────────────────────────────

  usePetsEyes(containerRef, {
    isSleeping,
    maxMovement: 2.5,
    lookMode: effectiveLookMode,
    disableBlink,
    disableTracking: isCompanion,
  });

  useExternalEyeOffset({
    containerRef,
    externalEyeOffset,
    externalEyeOffsetRef,
    isSleeping,
    variant: 'adult',
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  // In companion mode, reaction classes are applied by an outer wrapper to
  // keep the dangerouslySetInnerHTML div className-stable.

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center justify-center',
        formClass,
        stateClass,
        // No opacity change for sleeping — sleeping is a recipe overlay, not a visual dim
        !isCompanion && (effectiveReaction === 'listening' ||
          effectiveReaction === 'swaying' ||
          effectiveReaction === 'happy') &&
          'animate-pets-sway',
        !isCompanion && effectiveReaction === 'singing' && 'animate-pets-bounce',
        className,
      )}
      style={isFacingLeft ? { transform: 'scaleX(-1)' } : undefined}
    >
      <PetsAdultSvgRenderer
        pets={pets}
        isSleeping={isSleeping}
        recipe={recipe}
        recipeLabel={recipeLabel}
        emotion={emotion}
        bodyEffects={bodyEffects}
        customForms={customForms}
        className="size-full"
      />
    </div>
  );
}
