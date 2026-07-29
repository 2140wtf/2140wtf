import { ArrowLeft, ArrowRight, ArrowUp, Shield, Swords, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BattleHumanPlayers, BattleInputState, PlayerInput } from '../types/battle.types';

export interface BattleTouchControlsProps {
  inputRef: React.MutableRefObject<BattleInputState>;
  /** Only human-controlled fighters get buttons — a bot needs none. */
  players: BattleHumanPlayers;
  /**
   * `overlay`: absolute thumb clusters hugging the arena's left/right edges
   * (landscape play — thumbs reach both sides without covering the fight).
   * `below`: a static control row rendered under the arena (portrait play —
   * nothing overlaps the battle).
   */
  layout?: 'overlay' | 'below';
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
  big?: boolean;
}

function ControlButton({
  inputRef,
  player,
  action,
  children,
  className,
  isAttack,
  big,
}: ControlButtonProps) {
  return (
    <button
      type="button"
      aria-label={`${player} ${action}`}
      className={cn(
        'flex items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm active:scale-95 active:bg-black/70',
        big ? 'h-16 w-16' : 'h-12 w-12',
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

interface PadProps {
  inputRef: React.MutableRefObject<BattleInputState>;
  player: PlayerKey;
  big?: boolean;
}

/** Left-thumb pad: move left/right. */
function MovePad({ inputRef, player, big }: PadProps) {
  return (
    <div className="flex items-center gap-3">
      <ControlButton inputRef={inputRef} player={player} action="left" big={big} className="rounded-2xl">
        <ArrowLeft className={big ? 'size-7' : 'size-5'} />
      </ControlButton>
      <ControlButton inputRef={inputRef} player={player} action="right" big={big} className="rounded-2xl">
        <ArrowRight className={big ? 'size-7' : 'size-5'} />
      </ControlButton>
    </div>
  );
}

/** Right-thumb pad: jump + block + sword + fireball. */
function ActionPad({ inputRef, player, big }: PadProps) {
  return (
    <div className="flex items-center gap-3">
      <ControlButton inputRef={inputRef} player={player} action="jump" big={big}>
        <ArrowUp className={big ? 'size-7' : 'size-5'} />
      </ControlButton>
      <ControlButton inputRef={inputRef} player={player} action="block" big={big}>
        <Shield className={big ? 'size-7' : 'size-5'} />
      </ControlButton>
      <ControlButton
        inputRef={inputRef}
        player={player}
        action="sword"
        isAttack
        big={big}
        className="bg-primary/80 text-primary-foreground"
      >
        <Swords className={big ? 'size-7' : 'size-5'} />
      </ControlButton>
      <ControlButton
        inputRef={inputRef}
        player={player}
        action="fireball"
        isAttack
        big={big}
        className="bg-orange-500/80 text-white"
      >
        <Flame className={big ? 'size-7' : 'size-5'} />
      </ControlButton>
    </div>
  );
}

/** Compact full control set for one side of a two-player-one-phone match. */
function FullPad({ inputRef, player, side }: PadProps & { side: 'left' | 'right' }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        side === 'left' ? 'items-start' : 'items-end',
      )}
    >
      <div className="flex items-center gap-2">
        <ControlButton inputRef={inputRef} player={player} action="left" className="rounded-2xl">
          <ArrowLeft className="size-5" />
        </ControlButton>
        <ControlButton inputRef={inputRef} player={player} action="right" className="rounded-2xl">
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

function humanOnly(players: BattleHumanPlayers): PlayerKey | null {
  if (players.p1 && !players.p2) return 'p1';
  if (players.p2 && !players.p1) return 'p2';
  return null;
}

export function BattleTouchControls({
  inputRef,
  players,
  layout = 'overlay',
  className,
}: BattleTouchControlsProps) {
  const solo = humanOnly(players);

  if (layout === 'below') {
    // Portrait: controls sit UNDER the arena, nothing covers the fight.
    if (solo) {
      return (
        <div className={cn('flex items-center justify-between gap-3 px-1 py-2', className)}>
          <MovePad inputRef={inputRef} player={solo} big />
          <ActionPad inputRef={inputRef} player={solo} big />
        </div>
      );
    }
    return (
      <div className={cn('flex flex-col gap-3 px-1 py-2', className)}>
        {players.p1 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">P1</span>
            <MovePad inputRef={inputRef} player="p1" />
            <ActionPad inputRef={inputRef} player="p1" />
          </div>
        )}
        {players.p2 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-bold uppercase text-muted-foreground">P2</span>
            <MovePad inputRef={inputRef} player="p2" />
            <ActionPad inputRef={inputRef} player="p2" />
          </div>
        )}
      </div>
    );
  }

  // Landscape overlay: thumbs hug the left/right edges.
  return (
    <div className={cn('pointer-events-none absolute inset-0 z-10', className)}>
      {solo ? (
        <>
          <div className="pointer-events-auto absolute left-3 top-1/2 -translate-y-1/2">
            <MovePad inputRef={inputRef} player={solo} big />
          </div>
          <div className="pointer-events-auto absolute right-3 top-1/2 -translate-y-1/2">
            <ActionPad inputRef={inputRef} player={solo} big />
          </div>
        </>
      ) : (
        <>
          {players.p1 && (
            <div className="pointer-events-auto absolute bottom-4 left-4">
              <FullPad inputRef={inputRef} player="p1" side="left" />
            </div>
          )}
          {players.p2 && (
            <div className="pointer-events-auto absolute bottom-4 right-4">
              <FullPad inputRef={inputRef} player="p2" side="right" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
