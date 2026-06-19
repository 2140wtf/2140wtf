import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PetsAdultSvgRenderer } from '@/pets/ui/PetsAdultSvgRenderer';
import { PetsBabySvgRenderer } from '@/pets/ui/PetsBabySvgRenderer';
import { petsCompanionToPets } from '@/pets/ui/lib/adapters';
import type { BattleFighter } from '../types/battle.types';

export interface BattlePetSpriteProps {
  fighter: BattleFighter;
  scale: number;
  className?: string;
}

export function BattlePetSprite({ fighter, scale, className }: BattlePetSpriteProps) {
  const pets = useMemo(() => petsCompanionToPets(fighter.pet), [fighter.pet]);
  const width = Math.round(fighter.width * scale);
  const height = Math.round(fighter.height * scale);
  const left = Math.round((fighter.x - fighter.width / 2) * scale);
  const bottom = Math.round(fighter.y * scale);

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
        )}
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
