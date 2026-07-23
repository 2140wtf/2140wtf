import { Trophy, RotateCcw, Home, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BattlePlayerIndex } from '../types/battle.types';

export interface BattleResultOverlayProps {
  winner: BattlePlayerIndex | null;
  fighterNames: [string, string];
  prizeAmount: number;
  mode: 'demo-sats' | 'btc-sats' | 'real-sats';
  isPayoutPending: boolean;
  onRematch: () => void;
  onExit: () => void;
}

export function BattleResultOverlay({
  winner,
  fighterNames,
  prizeAmount,
  mode,
  isPayoutPending,
  onRematch,
  onExit,
}: BattleResultOverlayProps) {
  const winnerName = winner === null ? 'Draw' : fighterNames[winner];

  const prizeLabel = (() => {
    if (mode === 'real-sats') return `${prizeAmount * 2} real sats`;
    if (mode === 'btc-sats') return `${prizeAmount} ₿AO sats`;
    return `${prizeAmount} demo sats`;
  })();

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border/50 bg-background p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10">
          <Trophy className="size-8 text-primary" />
        </div>

        <h2 className="text-2xl font-bold">
          {winner === null ? 'It\'s a Draw!' : `${winnerName} Wins!`}
        </h2>

        {winner !== null && (
          <p className="mt-2 text-muted-foreground">
            {mode === 'btc-sats'
              ? 'Real sats payout is coming soon.'
              : `+${prizeLabel} awarded to the winner.`}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <Button
            className="w-full"
            onClick={onRematch}
            disabled={isPayoutPending}
          >
            <RotateCcw className="mr-2 size-4" />
            Rematch
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={onExit}
            disabled={isPayoutPending}
          >
            <Home className="mr-2 size-4" />
            Back to Pets
          </Button>
        </div>

        {isPayoutPending && (
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Swords className="size-3 animate-spin" />
            Claiming reward…
          </p>
        )}
      </div>
    </div>
  );
}
