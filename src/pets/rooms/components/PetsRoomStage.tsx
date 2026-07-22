/**
 * PetsRoomStage — Absolutely positioned Pets visual overlay for room display.
 *
 * Uses the room's shell coordinate system directly:
 * - Ground line at `top: (1 - ROOM_FLOOR_RATIO) * 100%` of the shell.
 * - Pets body bottom is anchored to this ground line.
 * - Pets name floats above the visual and bobs with the Pets.
 * - An animated shadow ellipse sits at the ground line below the Pets.
 *
 * Sizing uses percentage-of-room-width so Pets scales proportionally with
 * the room canvas (same coordinate system as furniture).
 *
 * This component must be rendered inside an `absolute inset-0` wrapper that
 * shares the same positioning parent as the wall/floor background layers.
 *
 * Stats are rendered separately by PetsRoomStatusHud in the top HUD area.
 */

import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PetsStageVisual } from '@/pets/ui/PetsStageVisual';
import { ReactionSparkles, ReactionBubbles } from '@/pets/ui/ReactionOverlays';
import { FloatingSocialHearts } from '@/pets/ui/FloatingSocialHearts';
import { PetBirthdayConfetti } from '@/pets/ui/PetBirthdayConfetti';
import { EggTapTarget } from './EggTapTarget';
import { ROOM_FLOOR_RATIO, getPetsBodyBottomInset } from '../lib/room-layout-schema';
import { cn } from '@/lib/utils';
import { usePetLife, useCurrentBlockHeight, getBirthBlockHeight } from '@/pets/core/lib/pets-life';
import { toast } from '@/hooks/useToast';

import type { PetsCompanion } from '@/pets/core/lib/pets';
import type { PetsEmotion } from '@/pets/ui/lib/emotion-types';
import type { PetsVisualRecipe } from '@/pets/ui/lib/recipe';
import type { PetsReactionState } from '@/pets/actions';
import type { InteractionReactionState } from '@/pets/ui/hooks/useInteractionReaction';
import type { PetsFacing } from '@/pets/ui/hooks/usePetsDirectInteraction';
import { usePets3DEnabled } from '@/pets/three-d/hooks/usePets3DEnabled';
import { usePets3DAsset } from '@/pets/three-d/hooks/usePets3DAsset';
import { usePets3DRoomAsset } from '@/pets/three-d/hooks/usePets3DRoomAsset';

const Pets3DVisual = lazy(() =>
  import('@/pets/three-d/components/Pets3DVisual').then((m) => ({ default: m.Pets3DVisual })),
);

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PetsRoomStageProps {
  companion: PetsCompanion;
  currentStats: {
    hunger: number;
    happiness: number;
    health: number;
    hygiene: number;
    energy: number;
  };
  isSleeping: boolean;
  isEgg: boolean;
  statusRecipe: PetsVisualRecipe | undefined;
  statusRecipeLabel: string | undefined;
  effectiveEmotion: PetsEmotion;
  hasDevOverride: boolean;
  petsReaction: PetsReactionState;
  /** Temporary interaction reaction (sparkles, bubbles, hearts, body animation). */
  interactionReaction?: InteractionReactionState;
  /** Called when the egg is tapped on the room stage (starts/completes hatching). */
  onEggClick?: () => void;
  /** Whether the foreground egg tap target is allowed. Disable when drawers overlay the room. */
  eggTapEnabled?: boolean;
  /** Current horizontal facing direction. */
  facing?: PetsFacing;
  /** Whether the pointer is hovering the pet (drives hover-lean animation). */
  isHovered?: boolean;
  /** Pointer handlers for direct hover/click interactions. */
  interactionProps?: {
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
    onClick?: () => void;
  };
  stageRef: React.RefObject<HTMLDivElement | null>;
}

// ─── Ground line position (% from top of shell) ──────────────────────────────

const GROUND_LINE_PCT = (1 - ROOM_FLOOR_RATIO) * 100;

// ─── Component ────────────────────────────────────────────────────────────────

export function PetsRoomStage({
  companion,
  currentStats,
  isSleeping,
  isEgg,
  statusRecipe,
  statusRecipeLabel,
  effectiveEmotion,
  hasDevOverride,
  petsReaction,
  interactionReaction,
  onEggClick,
  eggTapEnabled = true,
  facing,
  isHovered = false,
  interactionProps,
  stageRef,
}: PetsRoomStageProps) {
  // 3D rendering gate: only for adult pets when the user has enabled 3D and a
  // valid Blossom-hosted GLB asset is resolved.
  const pets3dEnabled = usePets3DEnabled();
  const asset3d = usePets3DAsset(companion);
  const roomAsset3d = usePets3DRoomAsset(companion);
  const show3D = pets3dEnabled && !isEgg && companion.stage === 'adult' && asset3d !== undefined;

  // Body-bottom inset: how much of the visual box is empty below the body
  const bodyBottomInset = getPetsBodyBottomInset(companion.stage, companion.adultType ?? undefined);

  // Bob animation duration — shared between the Pets bob and the shadow breathe
  const bobDuration = `${4 - (currentStats.happiness / 100) * 1.5}s`;

  // Pet life in Bitcoin-block time (10 min blocks, 2016-block epochs).
  const { config } = useAppContext();
  const petLife = usePetLife(companion.event.created_at);
  const currentBlockHeight = useCurrentBlockHeight(config.esploraApis);
  const birthBlockHeight = getBirthBlockHeight(companion.event.created_at, currentBlockHeight);
  const lastLifeToastAt = useRef<number>(0);

  // 100,000-block birthday celebration.
  const [showBirthdayConfetti, setShowBirthdayConfetti] = useState(false);
  const celebratedMilestone = useRef<number | undefined>(undefined);

  useEffect(() => {
    const milestone = petLife?.milestoneBlocks;
    if (!petLife?.isBirthdayMilestone || milestone === undefined || milestone === celebratedMilestone.current) {
      return;
    }
    celebratedMilestone.current = milestone;
    setShowBirthdayConfetti(true);
    toast({
      title: `🎉 Happy ${milestone.toLocaleString()} blocks!`,
      description: `Your NOSTR PET is celebrating another 100,000-block birthday.`,
    });
  }, [petLife]);

  const handleLifeBadgeHover = useCallback(() => {
    if (!petLife) return;
    const now = Date.now();
    if (now - lastLifeToastAt.current < 4000) return;
    lastLifeToastAt.current = now;
    const birthText = birthBlockHeight
      ? ` Born at block ${birthBlockHeight.toLocaleString()}.`
      : '';
    toast({
      title: `${companion.name} • ${petLife.ageLabel}`,
      description: `Bitcoin-block age: ${petLife.label}. e = epoch (2016 blocks), b = block.${birthText}`,
    });
  }, [petLife, birthBlockHeight, companion.name]);

  return (
    <div ref={stageRef} data-pets-stage={companion.stage} className="absolute inset-0 pointer-events-none">
      {/* Full-room 3D world — rendered behind the 2D pet wrapper so labels and
          the life badge still float on top. Only active for adult pets with a
          resolved 3D asset and 3D mode enabled. */}
      {show3D && (
        <div className="absolute inset-0 z-0 pointer-events-auto">
          <ErrorBoundary
            fallback={() => (
              <PetsStageVisual
                companion={companion}
                size="lg"
                animated={!isSleeping}
                reaction={petsReaction}
                recipe={hasDevOverride ? undefined : statusRecipe}
                recipeLabel={hasDevOverride ? undefined : statusRecipeLabel}
                emotion={effectiveEmotion}
                onEggClick={onEggClick}
                facing={facing}
                className="!size-full"
              />
            )}
          >
            <Suspense
              fallback={
                <PetsStageVisual
                  companion={companion}
                  size="lg"
                  animated={!isSleeping}
                  reaction={petsReaction}
                  recipe={hasDevOverride ? undefined : statusRecipe}
                  recipeLabel={hasDevOverride ? undefined : statusRecipeLabel}
                  emotion={effectiveEmotion}
                  onEggClick={onEggClick}
                  facing={facing}
                  className="!size-full"
                />
              }
            >
              <Pets3DVisual
                asset={asset3d}
                roomAsset={roomAsset3d}
                isSleeping={isSleeping}
                className="!size-full"
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {/* Pets anchor: full-width at the ground line.
          Uses inset-x-0 so descendant percentage widths resolve against
          room canvas width — keeping Pets proportional with furniture.
          Vertical alignment:
          1. Body wrapper translateY(-100%) → wrapper bottom = ground line.
          2. Then translateY(+bodyBottomInset%) → compensates for SVG whitespace
             below the visible body, so the BODY bottom lands at the ground line.
       */}
      <div
        className="absolute inset-x-0"
        style={{ top: `${GROUND_LINE_PCT}%` }}
      >
        {/* Ground shadow — radial-gradient ellipse at the ground line, behind the Pets.
            Breathes in sync with the bob: contracts when Pets is up, expands when down.
            Centered at 50% of anchor (= room center) via left + translateX(-50%).
            Uses aspect-ratio for height so it doesn't depend on anchor's auto height. */}
        <div
          className="absolute z-0 pointer-events-none"
          aria-hidden
          style={{
            top: 4,
            left: '50%',
            transformOrigin: 'center center',
            background: 'radial-gradient(ellipse, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.13) 38%, transparent 68%)',
            width: isEgg ? '22%' : '28%',
            aspectRatio: isEgg ? '4' : '4.5',
            ...(!isSleeping
              ? { animation: `pets-shadow-breathe ${bobDuration} ease-in-out infinite` }
              : { transform: 'translateX(-50%)' }
            ),
          }}
        />
        {/* Body alignment wrapper: block fills anchor width, shifted up vertically.
            Children's % widths resolve against this (= room width). */}
        <div
          className="relative z-10"
          style={{ transform: `translateY(calc(-100% + ${bodyBottomInset}%))` }}
        >
          {/* Bob wrapper: full-width flex container that centers the Pets horizontally */}
          <div
            className="relative w-full flex justify-center"
            style={!isSleeping ? {
              animation: `pets-bob ${bobDuration} ease-in-out infinite`,
            } : undefined}
          >
            {/* Pets name — floating label above the visual, bobs but does not sway */}
            {!isEgg && (
              <div
                className="absolute bottom-full left-1/2 mb-1 pointer-events-none"
                style={{ transform: 'translateX(-50%)' }}
              >
                <span
                  className="whitespace-nowrap text-sm font-bold drop-shadow-sm"
                  style={{ color: companion.visualTraits.baseColor }}
                >
                  {companion.name}
                </span>
              </div>
            )}
            {/* Visual wrapper — same width as the pet, anchors the life badge to
                the top-right corner of the pet visual (not the whole room). */}
            <div className="relative" style={{ width: isEgg ? '34%' : '30%' }}>
              {/* Life badge — floats above the top-right corner of the pet visual. */}
              {petLife && (
                <div
                  className="absolute -top-7 right-0 z-20 pointer-events-auto cursor-help"
                  onMouseEnter={handleLifeBadgeHover}
                >
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/70 backdrop-blur-sm border border-border/20 shadow-sm">
                    <span className="text-[10px] leading-none text-amber-500 font-bold">₿</span>
                    <span className="text-[10px] sm:text-xs leading-none font-semibold text-foreground/80 whitespace-nowrap">
                      {petLife.ageLabel}
                    </span>
                  </div>
                </div>
              )}

              {/* Birthday confetti shower for 100,000-block milestones. */}
              {showBirthdayConfetti && (
                <PetBirthdayConfetti
                  className="absolute -top-8 -left-1/2 -right-1/2 h-48 z-30"
                  onComplete={() => setShowBirthdayConfetti(false)}
                />
              )}

              {/* Interaction wrapper — receives pointer events and sways. */}
              {isEgg && onEggClick && eggTapEnabled && (
                <div className="absolute inset-0 -m-6 pointer-events-none rounded-full border-2 border-dashed border-primary/30 animate-pulse" />
              )}
              <div
                data-pets-visual
                className={cn(
                  'relative transition-all duration-500',
                  eggTapEnabled ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none',
                )}
                style={{
                  width: '100%',
                  aspectRatio: '1',
                  transformOrigin: 'center bottom',
                  ...(!isSleeping ? {
                    animation: `pets-sway ${6 - (currentStats.happiness / 100) * 2}s ease-in-out infinite`,
                  } : undefined),
                }}
                {...(eggTapEnabled
                  ? (isEgg ? { onPointerEnter: interactionProps?.onPointerEnter, onPointerLeave: interactionProps?.onPointerLeave } : interactionProps)
                  : undefined)}
              >
                {/* Body animation wrapper — isolated from sway so direct-interaction
                    animations (hover-lean, poke-wiggle) don't override it. */}
                <div
                  className={cn(
                    'absolute inset-0',
                    interactionReaction?.bodyAnimation,
                    isHovered && 'animate-pets-hover-lean',
                  )}
                  style={{ transformOrigin: 'center bottom' }}
                >
                  <div className="absolute inset-0 -m-16 sm:-m-20 bg-primary/5 rounded-full blur-3xl" />
                  {!show3D && (
                    <PetsStageVisual
                      companion={companion}
                      size="lg"
                      animated={!isSleeping}
                      reaction={petsReaction}
                      recipe={hasDevOverride ? undefined : statusRecipe}
                      recipeLabel={hasDevOverride ? undefined : statusRecipeLabel}
                      emotion={effectiveEmotion}
                      onEggClick={eggTapEnabled ? onEggClick : undefined}
                      facing={facing}
                      className="!size-full"
                    />
                  )}
                  {/* Interaction reaction overlays — sparkles, bubbles, hearts */}
                  <ReactionSparkles active={interactionReaction?.sparkles ?? false} />
                  <ReactionBubbles active={interactionReaction?.bubbles ?? false} showBackdrop={false} />
                  <FloatingSocialHearts active={interactionReaction?.hearts ?? false} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <EggTapTarget
        stageRef={stageRef}
        onClick={onEggClick}
        enabled={isEgg && !!onEggClick && eggTapEnabled}
      />
    </div>
  );
}
