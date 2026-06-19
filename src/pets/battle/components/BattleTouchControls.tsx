import { ArrowLeft, ArrowRight, ArrowUp, Shield, Swords, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BattleInputState, PlayerInput } from '../types/battle.types';

export interface BattleTouchControlsProps {
  inputRef: React.MutableRefObject<BattleInputState>;
  className?: string;
}

type PlayerKey = 'p1' | 'p2';
type ActionKey = keyof PlayerInput;

function setInputAction(
  input: BattleInputState,
  player: PlayerKey,
  action: ActionKey,
  pressed: boolean,
): void {
  input[player][action] = pressed;
}

interface ControlButtonProps {
  inputRef: React.MutableRefObject<BattleInputState>;
  player: PlayerKey;
  action: ActionKey;
  children: React.ReactNode;
  className?: string;
  isAttack?: boolean;
}

function ControlButton({
  inputRef,
  player,
  action,
  children,
  className,
  isAttack,
}: ControlButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm active:scale-95 active:bg-black/70 sm:h-14 sm:w-14',
        className,
      )}
      style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        setInputAction(inputRef.current, player, action, true);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        event.preventDefault();
        if (!isAttack) {
          setInputAction(inputRef.current, player, action, false);
        }
      }}
      onPointerLeave={() => {
        if (!isAttack) {
          setInputAction(inputRef.current, player, action, false);
        }
      }}
    >
      {children}
    </button>
  );
}

function PlayerControls({
  inputRef,
  player,
  side,
}: {
  inputRef: React.MutableRefObject<BattleInputState>;
  player: PlayerKey;
  side: 'left' | 'right';
}) {
  return (
    <div
      className={cn(
        'absolute bottom-4 flex flex-col gap-3',
        side === 'left' ? 'left-4 items-start' : 'right-4 items-end',
      )}
    >
      <div className="flex items-center gap-2">
        <ControlButton
          inputRef={inputRef}
          player={player}
          action="left"
          className="rounded-2xl"
        >
          <ArrowLeft className="size-5" />
        </ControlButton>
        <ControlButton
          inputRef={inputRef}
          player={player}
          action="right"
          className="rounded-2xl"
        >
          <ArrowRight className="size-5" />
        </ControlButton>
        <ControlButton inputRef={inputRef} player={player} action="jump">
          <ArrowUp className="size-5" />
        </ControlButton>
      </div>
      <div className="flex items-center gap-2">
        <ControlButton inputRef={inputRef} player={player} action="block">
          <Shield className="size-5" />
        </ControlButton>
        <ControlButton
          inputRef={inputRef}
          player={player}
          action="sword"
          isAttack
          className="bg-primary/80 text-primary-foreground"
        >
          <Swords className="size-5" />
        </ControlButton>
        <ControlButton
          inputRef={inputRef}
          player={player}
          action="fireball"
          isAttack
          className="bg-orange-500/80 text-white"
        >
          <Flame className="size-5" />
        </ControlButton>
      </div>
    </div>
  );
}

export function BattleTouchControls({ inputRef, className }: BattleTouchControlsProps) {
  return (
    <div
      className={cn(
        'pointer-events-auto absolute inset-0 z-10 sm:hidden',
        className,
      )}
    >
      <PlayerControls inputRef={inputRef} player="p1" side="left" />
      <PlayerControls inputRef={inputRef} player="p2" side="right" />
    </div>
  );
}
