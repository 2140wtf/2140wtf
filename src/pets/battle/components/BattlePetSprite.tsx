import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PetsAdultSvgRenderer } from '@/pets/ui/PetsAdultSvgRenderer';
import { PetsBabySvgRenderer } from '@/pets/ui/PetsBabySvgRenderer';
import { petsCompanionToPets } from '@/pets/ui/lib/adapters';
import { MOVE_DEFS } from '../lib/moves';
import type { BattleFighter } from '../types/battle.types';

export interface BattlePetSpriteProps {
  fighter: BattleFighter;
  scale: number;
  className?: string;
}

/**
 * Sprite body transform for the active move: full rotations for salto /
 * swirl / flip-over, a static tilt for dive-kick and uppercut. Progress is
 * time-based so the animation tracks the simulation exactly.
 */
function moveTransform(fighter: BattleFighter): string {
  const active = fighter.activeMove;
  if (!active) return 'none';
  const def = MOVE_DEFS[active.id as keyof typeof MOVE_DEFS];
  if (!def) return 'none';
  const progress = Math.min(1, (performance.now() - active.startedAt) / def.durationMs);

  if (def.spinRotations) {
    const deg = def.spinRotations * 360 * progress * fighter.facing;
    return `rotate(${deg}deg)`;
  }
  if (def.tiltDeg) {
    return `rotate(${def.tiltDeg * fighter.facing}deg)`;
  }
  return 'none';
}

export function BattlePetSprite({ fighter, scale, className }: BattlePetSpriteProps) {
  const pets = useMemo(() => petsCompanionToPets(fighter.pet), [fighter.pet]);
  const width = Math.round(fighter.width * scale);
  const height = Math.round(fighter.height * scale);
  const left = Math.round((fighter.x - fighter.width / 2) * scale);
  const bottom = Math.round(fighter.y * scale);

  const dashing = fighter.dashUntil > performance.now();
  const spin = moveTransform(fighter);

  return (
    <div
      className={cn('absolute will-change-transform', className)}
      style={{
        left,
        bottom,
        width,
        height,
        transform: `scaleX(${fighter.facing})`,
        transformOrigin: 'center bottom',
      }}
    >
      <div
        className={cn(
          'relative size-full transition-colors duration-75',
          fighter.isHit && 'brightness-150 saturate-200',
          dashing && 'brightness-125',
        )}
        style={{ transform: spin, transformOrigin: 'center center' }}
      >
        {fighter.pet.stage === 'adult' ? (
          <PetsAdultSvgRenderer
            pets={pets}
            isSleeping={false}
            emotion="angry"
            className="size-full"
          />
        ) : (
          <PetsBabySvgRenderer
            pets={pets}
            isSleeping={false}
            emotion="angry"
            className="size-full"
          />
        )}
      </div>
      <div
        className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-white/90 drop-shadow-md"
        style={{ transform: `translateX(-50%) scaleX(${fighter.facing})` }}
      >
        {fighter.pet.name}
      </div>
    </div>
  );
}
