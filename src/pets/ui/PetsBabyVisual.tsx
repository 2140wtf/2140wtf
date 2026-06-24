/**
 * PetsBabyVisual — Visual wrapper for rendering Pets babies.
 *
 * Responsibilities:
 *   - Owns the container ref for eye hooks to query SVG DOM
 *   - Runs usePetsEyes (blink RAF loop, optional mouse tracking)
 *   - Runs useExternalEyeOffset (companion gaze RAF loop)
 *   - Applies reaction CSS classes (sway/bounce) in page mode
 *   - Delegates SVG rendering to PetsBabySvgRenderer
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
import { PetsBabySvgRenderer } from './PetsBabySvgRenderer';

export interface PetsBabyVisualProps {
  pets: Pets;
  reaction?: PetsReactionState;
  lookMode?: PetsLookMode;
  disableBlink?: boolean;
  externalEyeOffset?: ExternalEyeOffset;
  /** Ref-based external eye offset (imperative — no rerenders). Preferred for companion mode. */
  externalEyeOffsetRef?: RefObject<ExternalEyeOffset>;
  /** Render mode. Default: 'page'. */
  renderMode?: PetsRenderMode;
  /** Pre-resolved visual recipe. Takes precedence over `emotion`. */
  recipe?: PetsVisualRecipe;
  /** Label for the recipe (CSS class names). */
  recipeLabel?: string;
  /** Named emotion preset. Ignored when `recipe` is provided. */
  emotion?: PetsEmotion;
  /** Body-level visual effects — for manual/external use only. */
  bodyEffects?: BodyEffectsSpec;
  /** Horizontal facing direction. `left` mirrors the visual with scaleX(-1). */
  facing?: PetsFacing;
  className?: string;
}

export function PetsBabyVisual({
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
  className,
}: PetsBabyVisualProps) {
  const isSleeping = isPetsSleeping(pets);

  // DOM query boundary for eye hooks. See PetsAdultVisual for details.
  const containerRef = useRef<HTMLDivElement>(null);

  const isCompanion = renderMode === 'companion';

  const effectiveReaction = isSleeping ? 'idle' : reaction;
  const isFacingLeft = facing === 'left';
  const effectiveLookMode = isFacingLeft ? 'forward' : lookMode;

  // ── Eye hooks ──────────────────────────────────────────────────────────────

  usePetsEyes(containerRef, {
    isSleeping,
    maxMovement: 2,
    lookMode: effectiveLookMode,
    disableBlink,
    disableTracking: isCompanion,
  });

  useExternalEyeOffset({
    containerRef,
    externalEyeOffset,
    externalEyeOffsetRef,
    isSleeping,
    variant: 'baby',
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center justify-center',
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
      <PetsBabySvgRenderer
        pets={pets}
        isSleeping={isSleeping}
        recipe={recipe}
        recipeLabel={recipeLabel}
        emotion={emotion}
        bodyEffects={bodyEffects}
        className="size-full"
      />
    </div>
  );
}
