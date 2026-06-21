import { Swords, Flame, Shield, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import type { BattleFighter, BattleState } from '../types/battle.types';

export interface BattleHudProps {
  state: BattleState;
  className?: string;
}

function formatTime(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function FighterHud({
  fighter,
  align,
}: {
  fighter: BattleFighter;
  align: 'left' | 'right';
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 min-w-0', align === 'right' && 'items-end')}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-white drop-shadow truncate max-w-[120px] sm:max-w-[180px]">
          {fighter.pet.name}
        </span>
        {fighter.isBlocking && (
          <Shield className="size-4 text-blue-300" />
        )}
      </div>
      <Progress
        value={(fighter.health / fighter.maxHealth) * 100}
        className="h-3 w-full max-w-[220px] bg-black/40"
        indicatorClassName={cn(
          fighter.health > 50 ? 'bg-emerald-500' : fighter.health > 25 ? 'bg-amber-500' : 'bg-rose-500',
        )}
      />
      <div className="flex items-center gap-1.5 w-full max-w-[220px]">
        <Flame className="size-3.5 text-orange-400" />
        <Progress
          value={(fighter.energy / fighter.maxEnergy) * 100}
          className="h-1.5 flex-1 bg-black/40"
          indicatorClassName="bg-orange-400"
        />
      </div>
    </div>
  );
}

export function BattleHud({ state, className }: BattleHudProps) {
  const [fighter1, fighter2] = state.fighters;

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 sm:p-6',
        className,
      )}
    >
      <FighterHud fighter={fighter1} align="left" />

      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-lg font-mono font-bold text-white backdrop-blur-sm">
          <Timer className="size-4" />
          {formatTime(state.timeRemaining)}
        </div>
        {state.status === 'countdown' && (
          <span className="text-xs font-semibold uppercase tracking-wider text-white/80">
            Fight!
          </span>
        )}
      </div>

      <FighterHud fighter={fighter2} align="right" />
    </div>
  );
}

export function BattleControlsHelp({
  className,
  variant = 'overlay',
}: {
  className?: string;
  variant?: 'overlay' | 'inline';
}) {
  const p1 = 'P1: A/D move · W jump · S block · F sword · G fireball';
  const p2 = 'P2: ←/→ move · ↑ jump · ↓ block · L sword · ; fireball';

  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'hidden items-center justify-center gap-6 rounded-lg bg-muted/80 px-4 py-2 text-xs text-muted-foreground sm:flex',
          className,
        )}
      >
        <div className="flex items-center gap-1.5 font-medium">
          <Swords className="size-3.5" />
          {p1}
        </div>
        <div className="flex items-center gap-1.5 font-medium">
          <Swords className="size-3.5" />
          {p2}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute bottom-4 left-4 z-20 hidden rounded-lg bg-black/50 p-3 text-[10px] text-white/90 backdrop-blur-sm sm:block',
        className,
      )}
    >
      <div className="mb-1 flex items-center gap-1 font-bold">
        <Swords className="size-3" />
        {p1}
      </div>
      <div className="flex items-center gap-1 font-bold">
        <Swords className="size-3" />
        {p2}
      </div>
    </div>
  );
}
