/**
 * PetsStageVisual - Stage-aware visual component for Pets
 *
 * Routes to the appropriate visual component based on the Pets's life stage:
 *   - egg   → PetsEggVisual
 *   - baby  → PetsBabyVisual
 *   - adult → PetsAdultVisual
 *
 * This component is the single entry point for rendering any Pets visually.
 * It passes through visual recipe props to the stage-specific components.
 */

import { useMemo } from 'react';

import { PetsEggVisual, type PetsEggSize, type EggStatusEffects, type EggTourVisualState } from './PetsEggVisual';
import { PetsBabyVisual } from './PetsBabyVisual';
import { PetsAdultVisual } from './PetsAdultVisual';
import { FloatingMusicNotes } from './FloatingMusicNotes';
import { petsCompanionToPets } from './lib/adapters';
import { cn } from '@/lib/utils';
import type { PetsCompanion } from '@/pets/core/lib/pets';
import type { PetsLookMode } from './lib/usePetsEyes';
import type { PetsEmotion } from './lib/emotion-types';
import type { PetsVisualRecipe } from './lib/recipe';
import type { BodyEffectsSpec } from './lib/bodyEffects';
import type { PetsFacing } from './hooks/usePetsDirectInteraction';
import { useCustomForms } from '@/pets/three-d/hooks/useCustomForms';
import type { CustomPetForm } from '@/pets/three-d/lib/custom-forms-schema';

export type { PetsLookMode };

// ─── Types ────────────────────────────────────────────────────────────────────

export type PetsVisualSize = 'sm' | 'md' | 'lg';

export type PetsReaction = 'idle' | 'listening' | 'swaying' | 'singing' | 'happy';

export interface PetsStageVisualProps {
  companion: PetsCompanion;
  size?: PetsVisualSize;
  animated?: boolean;
  reaction?: PetsReaction;
  lookMode?: PetsLookMode;
  disableBlink?: boolean;
  /** Pre-resolved visual recipe. Takes precedence over `emotion`. */
  recipe?: PetsVisualRecipe;
  /** Label for the recipe (CSS class names). Required when `recipe` is provided. */
  recipeLabel?: string;
  /** Named emotion preset (convenience path). Ignored when `recipe` is provided. */
  emotion?: PetsEmotion;
  /**
   * Body-level visual effects — for manual/external use only.
   * Status-reaction body effects are already in the recipe.
   */
  bodyEffects?: BodyEffectsSpec;
  /** Tour visual state for egg stage - driven by the tour orchestration layer */
  tourVisualState?: EggTourVisualState;
  /** Callback when the egg is clicked during an interactive tour step */
  onTourEggClick?: () => void;
  /** Generic click callback for egg taps (passed through to EggGraphic) */
  onEggClick?: () => void;
  /** Horizontal facing direction. `left` mirrors the visual with scaleX(-1). */
  facing?: PetsFacing;
  /** Optional custom species map for previewing unsaved forms. */
  customForms?: Record<string, CustomPetForm>;
  /** Optional pointer handlers for direct hover/click interactions. */
  interactionProps?: {
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
    onClick?: () => void;
  };
  className?: string;
}

// ─── Size Configuration ───────────────────────────────────────────────────────

const SIZE_CONFIG: Record<PetsVisualSize, string> = {
  sm: 'size-14',
  md: 'size-24',
  lg: 'size-40',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PetsStageVisual({
  companion,
  size = 'md',
  animated = false,
  reaction = 'idle',
  lookMode = 'follow-pointer',
  disableBlink = false,
  recipe,
  recipeLabel,
  emotion = 'neutral',
  bodyEffects,
  tourVisualState,
  onTourEggClick,
  onEggClick,
  facing,
  customForms: customFormsProp,
  interactionProps,
  className,
}: PetsStageVisualProps) {
  const { stage } = companion;
  const isSleeping = companion.state === 'sleeping';
  const profileCustomForms = useCustomForms();
  const customForms = customFormsProp ?? profileCustomForms;

  const effectiveReaction = isSleeping ? 'idle' : reaction;

  const petsForVisual = useMemo(
    () => (stage === 'baby' || stage === 'adult' ? petsCompanionToPets(companion) : null),
    [companion, stage]
  );

  const showMusicNotes = effectiveReaction === 'listening';
  const containerClass = SIZE_CONFIG[size];

  const isFacingLeft = facing === 'left';

  if (stage === 'egg') {
    // Derive egg status effects from the recipe
    // Eggs don't have faces, so we translate recipe parts to egg-specific effects
    const eggStatusEffects: EggStatusEffects | undefined = recipe ? {
      // Dirty: hygiene-related body effects
      dirty: Boolean(recipe.bodyEffects?.dirtMarks?.enabled || recipe.bodyEffects?.stinkClouds?.enabled),
      // Sick: health-critical dizzy eyes → floating spirals for egg
      sick: Boolean(recipe.eyes?.dizzySpirals),
      // Happy: positive reaction or explicit happy state (not sad/crying)
      happy: effectiveReaction === 'happy' && !recipe.extras?.tears?.enabled,
    } : undefined;

    const handleEggClick = onEggClick
      ? (e: React.MouseEvent) => {
          e.stopPropagation();
          onEggClick();
        }
      : interactionProps?.onClick;

    return (
      <div
        className={cn('relative', containerClass, className, onEggClick && 'pointer-events-auto cursor-pointer')}
        style={isFacingLeft ? { transform: 'scaleX(-1)' } : undefined}
        onClick={handleEggClick}
        {...(onEggClick ? undefined : interactionProps)}
      >
        <PetsEggVisual
          companion={companion}
          size={size as PetsEggSize}
          animated={animated}
          reaction={effectiveReaction}
          statusEffects={eggStatusEffects}
          tourVisualState={tourVisualState}
          onTourEggClick={onTourEggClick}
          className="size-full"
        />
        <FloatingMusicNotes active={showMusicNotes} />
      </div>
    );
  }

  if (stage === 'baby' && petsForVisual) {
    return (
      <div
        className={cn('relative', containerClass, className)}
        {...interactionProps}
      >
        <PetsBabyVisual
          pets={petsForVisual}
          reaction={effectiveReaction}
          lookMode={lookMode}
          facing={facing}
          disableBlink={disableBlink}
          recipe={recipe}
          recipeLabel={recipeLabel}
          emotion={emotion}
          bodyEffects={bodyEffects}
          className="size-full"
        />
        <FloatingMusicNotes active={showMusicNotes} />
      </div>
    );
  }

  if (stage === 'adult' && petsForVisual) {
    return (
      <div
        className={cn('relative', containerClass, className)}
        {...interactionProps}
      >
        <PetsAdultVisual
          pets={petsForVisual}
          reaction={effectiveReaction}
          lookMode={lookMode}
          facing={facing}
          disableBlink={disableBlink}
          recipe={recipe}
          recipeLabel={recipeLabel}
          emotion={emotion}
          bodyEffects={bodyEffects}
          customForms={customForms}
          className="size-full"
        />
        <FloatingMusicNotes active={showMusicNotes} />
      </div>
    );
  }

  return null;
}
