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

import { PetsStageVisual } from '@/pets/ui/PetsStageVisual';
import { ReactionSparkles, ReactionBubbles } from '@/pets/ui/ReactionOverlays';
import { FloatingSocialHearts } from '@/pets/ui/FloatingSocialHearts';
import { EggTapTarget } from './EggTapTarget';
import { ROOM_FLOOR_RATIO, getPetsBodyBottomInset } from '../lib/room-layout-schema';
import { cn } from '@/lib/utils';
import { usePetLife } from '@/pets/core/lib/pets-life';

import type { PetsCompanion } from '@/pets/core/lib/pets';
import type { PetsEmotion } from '@/pets/ui/lib/emotion-types';
import type { PetsVisualRecipe } from '@/pets/ui/lib/recipe';
import type { PetsReactionState } from '@/pets/actions';
import type { InteractionReactionState } from '@/pets/ui/hooks/useInteractionReaction';

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
  stageRef,
}: PetsRoomStageProps) {
  // Body-bottom inset: how much of the visual box is empty below the body
  const bodyBottomInset = getPetsBodyBottomInset(companion.stage, companion.adultType ?? undefined);

  // Bob animation duration — shared between the Pets bob and the shadow breathe
  const bobDuration = `${4 - (currentStats.happiness / 100) * 1.5}s`;

  // Pet life in Bitcoin-block time (10 min blocks, 2016-block epochs).
  const petLife = usePetLife(companion.event.created_at);

  return (
    <div ref={stageRef} className="absolute inset-0 pointer-events-none">
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
            <div className="relative" style={{ width: isEgg ? '24%' : '30%' }}>
              {/* Life badge — floats above the top-right corner of the pet visual. */}
              {petLife && (
                <div
                  className="absolute -top-7 right-0 z-20 pointer-events-none"
                  title={`${petLife.totalBlocks.toLocaleString()} blocks lived`}
                >
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/70 backdrop-blur-sm border border-border/20 shadow-sm">
                    <span className="text-[10px] leading-none text-amber-500 font-bold">₿</span>
                    <span className="text-[10px] sm:text-xs leading-none font-semibold text-foreground/80 whitespace-nowrap">
                      {petLife.label}
                    </span>
                  </div>
                </div>
              )}

              {/* Sway wrapper (rotate animation) — separate from bob to avoid transform conflict. */}
              <div
                data-pets-visual
                className={cn(
                  'relative transition-all duration-500 pointer-events-none',
                  interactionReaction?.bodyAnimation,
                )}
                style={{
                  width: '100%',
                  aspectRatio: '1',
                  ...(!isSleeping ? {
                    animation: `pets-sway ${6 - (currentStats.happiness / 100) * 2}s ease-in-out infinite`,
                  } : undefined),
                }}
              >
                <div className="absolute inset-0 -m-16 sm:-m-20 bg-primary/5 rounded-full blur-3xl" />
                <PetsStageVisual
                  companion={companion}
                  size="lg"
                  animated={!isSleeping}
                  reaction={petsReaction}
                  recipe={hasDevOverride ? undefined : statusRecipe}
                  recipeLabel={hasDevOverride ? undefined : statusRecipeLabel}
                  emotion={effectiveEmotion}
                  onEggClick={onEggClick}
                  className="!size-full"
                />
                {/* Interaction reaction overlays — sparkles, bubbles, hearts */}
                <ReactionSparkles active={interactionReaction?.sparkles ?? false} />
                <ReactionBubbles active={interactionReaction?.bubbles ?? false} showBackdrop={false} />
                <FloatingSocialHearts active={interactionReaction?.hearts ?? false} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <EggTapTarget
        stageRef={stageRef}
        onClick={onEggClick}
        enabled={isEgg && !!onEggClick}
      />
    </div>
  );
}
