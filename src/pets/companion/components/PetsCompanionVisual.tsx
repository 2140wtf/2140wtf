/**
 * PetsCompanionVisual
 *
 * Visual component for rendering the companion Pets.
 *
 * Architecture:
 * - Outer shell: handles per-frame updates (float, shadow, drag state) — rerenders freely
 * - Float wrapper: owns translateY alignment + JS float offset (inline transform)
 * - Sway wrapper: owns CSS rotation animation only (animate-pets-sway)
 *   Kept separate from float wrapper so CSS @keyframes don't override the
 *   inline translateY, which would make Pets float above the ground.
 * - Inner MemoizedPetsVisual: renders the actual SVG — only rerenders when visual inputs change
 * - Eye gaze is driven imperatively via ref (no React rerenders for gaze)
 */

import { useMemo, useRef, memo, type RefObject } from 'react';

import { PetsBabyVisual } from '@/pets/ui/PetsBabyVisual';
import { PetsAdultVisual } from '@/pets/ui/PetsAdultVisual';
import { PetsStageVisual } from '@/pets/ui/PetsStageVisual';
import { FloatingSocialHearts } from '@/pets/ui/FloatingSocialHearts';
import { companionDataToPets } from '@/pets/ui/lib/adapters';
import { useEffectiveEmotion } from '@/pets/dev/useEmotionDev';
import { useRecipeFingerprint, useFillLevelUpdate } from '@/pets/ui/hooks/useFillLevelUpdate';
import type { PetsEmotion } from '@/pets/ui/lib/emotion-types';
import type { PetsVisualRecipe } from '@/pets/ui/lib/recipe';
import type { BodyEffectsSpec } from '@/pets/ui/lib/bodyEffects';
import type { Pets } from '@/pets/core/types/pets';
import type { PetsCompanion } from '@/pets/core/lib/pets';
import { cn } from '@/lib/utils';
import type { CompanionData, EyeOffset, CompanionDirection } from '../types/companion.types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface PetsCompanionVisualProps {
  companion: CompanionData;
  size: number;
  eyeOffsetRef: RefObject<EyeOffset>;
  direction: CompanionDirection;
  isDragging: boolean;
  isWalking: boolean;
  floatOffset?: { x: number; y: number; rotation: number };
  isOnGround?: boolean;
  distanceFromGround?: number;
  recipe?: PetsVisualRecipe;
  recipeLabel?: string;
  emotion?: PetsEmotion;
  bodyEffects?: BodyEffectsSpec;
  /** Optional CSS animation class applied to the inner body wrapper. */
  bodyAnimation?: string | null;
  /** Whether to show floating hearts. */
  hearts?: boolean;
  className?: string;
  debugMode?: boolean;
}

// ─── Memoized Inner Visual ────────────────────────────────────────────────────
//
// STABILITY CONTRACT:
// This component is the boundary that protects the SVG DOM subtree from the
// companion rerender storm (~60 renders/s from motion/float RAF loops).
// It renders PetsAdultVisual / PetsBabyVisual with renderMode="companion".
//
// It MUST only rerender when actual visual STRUCTURE changes:
//   pets, recipeFingerprint, recipeLabel, emotion, bodyEffects, stage
//
// It uses recipeFingerprint (not recipe reference) so that level-only
// changes (e.g. nausea drain) do NOT trigger rerenders. The fill level
// is updated imperatively from PetsCompanionVisual via useFillLevelUpdate.
//
// It MUST NOT receive or depend on per-frame values:
//   eyeOffset value, floatOffset, isDragging, isWalking, position, animationTime
//
// The eyeOffsetRef is a stable React ref — its identity never changes,
// so it is safe to pass without triggering rerenders.

interface MemoizedPetsVisualProps {
  stage: 'baby' | 'adult';
  pets: Pets;
  eyeOffsetRef: RefObject<EyeOffset>;
  recipe?: PetsVisualRecipe;
  /** Pre-computed structural fingerprint (excludes angerRise.level). */
  recipeFingerprint: string;
  recipeLabel?: string;
  emotion: PetsEmotion;
  bodyEffects?: BodyEffectsSpec;
}

const MemoizedPetsVisual = memo(function MemoizedPetsVisual({
  stage,
  pets,
  eyeOffsetRef,
  recipe,
  recipeFingerprint: _recipeFingerprint,
  recipeLabel,
  emotion,
  bodyEffects,
}: MemoizedPetsVisualProps) {
  if (stage === 'baby') {
    return (
      <PetsBabyVisual
        pets={pets}
        renderMode="companion"
        lookMode="forward"
        externalEyeOffsetRef={eyeOffsetRef}
        recipe={recipe}
        recipeLabel={recipeLabel}
        emotion={emotion}
        bodyEffects={bodyEffects}
        className="size-full"
      />
    );
  }

  return (
    <PetsAdultVisual
      pets={pets}
      renderMode="companion"
      lookMode="forward"
      externalEyeOffsetRef={eyeOffsetRef}
      recipe={recipe}
      recipeLabel={recipeLabel}
      emotion={emotion}
      bodyEffects={bodyEffects}
      className="size-full"
    />
  );
}, (prev, next) => {
  return (
    prev.stage === next.stage &&
    // Compare pets by visual-identity primitives, NOT by reference.
    // This prevents SVG rebuilds (and SMIL animation restarts) when the
    // upstream companion object gets a new reference with identical content
    // — e.g. during nausea recovery where only angerRise.level changes.
    prev.pets.id === next.pets.id &&
    prev.pets.baseColor === next.pets.baseColor &&
    prev.pets.secondaryColor === next.pets.secondaryColor &&
    prev.pets.eyeColor === next.pets.eyeColor &&
    prev.pets.adult?.evolutionForm === next.pets.adult?.evolutionForm &&
    prev.pets.seed === next.pets.seed &&
    prev.recipeFingerprint === next.recipeFingerprint &&
    prev.recipeLabel === next.recipeLabel &&
    prev.emotion === next.emotion &&
    prev.bodyEffects === next.bodyEffects
  );
});

// ─── Component ────────────────────────────────────────────────────────────────

export function PetsCompanionVisual({
  companion,
  size,
  eyeOffsetRef,
  direction,
  isDragging,
  isWalking,
  floatOffset = { x: 0, y: 0, rotation: 0 },
  isOnGround = true,
  distanceFromGround = 0,
  recipe: recipeProp,
  recipeLabel: recipeLabelProp,
  emotion: emotionProp,
  bodyEffects: bodyEffectsProp,
  bodyAnimation,
  hearts = false,
  className,
  debugMode = false,
}: PetsCompanionVisualProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pets = useMemo(() => companionDataToPets(companion), [companion]);

  // DEV ONLY: Get effective emotion from dev context (overrides production emotions)
  const devEmotion = useEffectiveEmotion();
  const hasDevOverride = devEmotion !== 'neutral';

  const effectiveRecipe = hasDevOverride ? undefined : recipeProp;
  const effectiveRecipeLabel = hasDevOverride ? undefined : recipeLabelProp;
  const effectiveEmotion = hasDevOverride ? devEmotion : (emotionProp ?? 'neutral');
  const effectiveBodyEffects = hasDevOverride ? undefined : bodyEffectsProp;

  // ── Fill level update (above memo boundary) ────────────────────────────────
  // Compute structural fingerprint (excludes angerRise.level) and run the
  // imperative gradient-stop update from here. This allows MemoizedPetsVisual
  // to block re-renders during level-only changes (e.g. nausea drain), keeping
  // SMIL spiral-eye animations running uninterrupted.
  const recipeFingerprint = useRecipeFingerprint(effectiveRecipe);
  useFillLevelUpdate(rootRef, pets.id, effectiveRecipe);

  // Float transform
  const isFacingLeft = direction === 'left';

  const petsTransform = useMemo(() => {
    const transforms: string[] = [];
    if (floatOffset.x !== 0 || floatOffset.y !== 0) {
      transforms.push(`translate(${floatOffset.x}px, ${floatOffset.y}px)`);
    }
    if (floatOffset.rotation !== 0) {
      transforms.push(`rotate(${floatOffset.rotation}deg)`);
    }
    if (isFacingLeft) {
      transforms.push('scaleX(-1)');
    }
    return transforms.length > 0 ? transforms.join(' ') : undefined;
  }, [floatOffset, isFacingLeft]);

  // Reaction state for CSS animations on the OUTER wrapper
  // When sleeping, always idle — no swaying/happy animation
  const isSleeping = companion.state === 'sleeping';
  const reaction = isSleeping ? 'idle' : isDragging ? 'happy' : isWalking ? 'swaying' : 'idle';

  // ── Shadow ─────────────────────────────────────────────────────────────────
  const SHADOW_FADE_DISTANCE = 30;
  const SHADOW_MAX_OPACITY = 0.35;

  const showShadow = isOnGround && !isDragging && distanceFromGround < SHADOW_FADE_DISTANCE;
  const floatHeight = Math.abs(floatOffset.y);
  const groundFadeRatio = Math.max(0, 1 - distanceFromGround / SHADOW_FADE_DISTANCE);
  const floatFadeRatio = Math.max(0.85, 1 - floatHeight * 0.02);
  const shadowOpacity = SHADOW_MAX_OPACITY * groundFadeRatio * floatFadeRatio;
  const shadowScale = 0.9 + 0.1 * groundFadeRatio * floatFadeRatio;


  return (
    <div
      ref={rootRef}
      className={cn('relative', className)}
      style={{ width: size, height: size }}
    >
      {/* Debug alignment markers */}
      {debugMode && (
        <>
          <div className="absolute inset-0 pointer-events-none" style={{ border: '2px solid lime', boxSizing: 'border-box' }} />
          <div className="absolute pointer-events-none" style={{ top: `${size * 0.88}px`, left: 0, right: 0, height: 2, backgroundColor: 'yellow' }} />
          <div className="absolute pointer-events-none" style={{ bottom: 0, left: 0, right: 0, height: 2, backgroundColor: 'cyan' }} />
          <div className="absolute pointer-events-none" style={{ top: 2, left: 2, fontSize: 8, color: 'white', backgroundColor: 'black', padding: '1px 2px' }}>
            shift: {size * 0.12}px
          </div>
        </>
      )}

      {/* Floor shadow */}
      {!debugMode && showShadow && shadowOpacity > 0.01 && (
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: -20,
            left: '50%',
            width: size * 0.5,
            height: size * 0.08,
            transform: `translateX(-50%) scaleX(${shadowScale})`,
            background: `radial-gradient(ellipse at center, rgba(0,0,0,${shadowOpacity}) 0%, rgba(0,0,0,${shadowOpacity * 0.5}) 40%, transparent 70%)`,
            borderRadius: '50%',
            filter: 'blur(4px)',
            opacity: groundFadeRatio,
            transition: 'opacity 0.15s ease-out, transform 0.1s ease-out',
          }}
        />
      )}

      {/*
        Float wrapper — owns translateY alignment + JS float offset.
        This is a separate element from the sway wrapper below so that
        the CSS animation on the sway wrapper does not override the
        inline transform here. (CSS @keyframes replace the entire
        `transform` property while active, which would drop the
        translateY alignment shift and cause Pets to float above
        the ground during walking.)
      */}
      <div
        className="size-full"
        style={{
          transform: [
            `translateY(${size * 0.12}px)`,
            petsTransform,
          ].filter(Boolean).join(' ') || undefined,
          transformOrigin: 'center bottom',
          transition: isDragging ? 'none' : 'transform 0.05s ease-out',
          ...(debugMode ? { outline: '2px dashed magenta' } : {}),
        }}
      >
        {/* Sway wrapper — CSS rotation only, no positioning transforms */}
        <div
          className={cn(
            'size-full',
            (reaction === 'swaying' || reaction === 'happy') && 'animate-pets-sway',
          )}
          style={{ transformOrigin: 'center bottom' }}
        >
          {/* Body animation wrapper — isolated from sway/direction transforms so
              direct interaction animations (hover-lean, poke-wiggle) don't wipe
              the parent's scaleX(-1) or rotation. */}
          <div
            className={cn('size-full', bodyAnimation)}
            style={{ transformOrigin: 'center bottom' }}
          >
            {companion.stage === 'egg' ? (
              <PetsStageVisual
                companion={companion as unknown as PetsCompanion}
                size="sm"
                animated={false}
                className="size-full"
              />
            ) : (
              <MemoizedPetsVisual
                stage={companion.stage}
                pets={pets}
                eyeOffsetRef={eyeOffsetRef}
                recipe={effectiveRecipe}
                recipeFingerprint={recipeFingerprint}
                recipeLabel={effectiveRecipeLabel}
                emotion={effectiveEmotion}
                bodyEffects={effectiveBodyEffects}
              />
            )}
            <FloatingSocialHearts active={hearts} />
          </div>
        </div>
      </div>
    </div>
  );
}
