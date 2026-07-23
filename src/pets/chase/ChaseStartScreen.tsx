import { Coins, Zap, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { type ChaseMode, CHASE_FIAT_COST, CHASE_SATS_PER_COIN, CHASE_RAILS } from './types';

interface ChaseStartScreenProps {
  coins: number;
  sats: number;
  onStart: (mode: ChaseMode) => void;
  /** If false, the BAO sats mode is disabled (e.g. in real-money mode). */
  allowSatsMode?: boolean;
}

export function ChaseStartScreen({ coins, sats, onStart, allowSatsMode = true }: ChaseStartScreenProps) {
  const canPlayFiat = coins >= CHASE_FIAT_COST;

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm z-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto size-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Zap className="size-7 text-primary" />
          </div>
          <CardTitle className="text-2xl">Chase BTC</CardTitle>
          <CardDescription>
            Run, jump, and duck through the ₿AO payment rails. Collect coins and claim demo sats.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-1.5 rounded-full bg-yellow-50 dark:bg-yellow-950/30 px-3 py-1.5 border border-yellow-200 dark:border-yellow-900">
              <Coins className="size-4 text-yellow-600" />
              <span className="font-semibold">{coins.toLocaleString()}</span>
              <span className="text-muted-foreground">coins</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 border border-amber-200 dark:border-amber-900">
              <Zap className="size-4 text-amber-600" />
              <span className="font-semibold">{sats.toLocaleString()}</span>
              <span className="text-muted-foreground">sats</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Button
              size="lg"
              className="w-full justify-between h-auto py-4"
              onClick={() => onStart('fiat')}
              disabled={!canPlayFiat}
            >
              <span className="flex flex-col items-start">
                <span className="font-semibold">Play with Fiat Coins</span>
                <span className="text-xs opacity-90 font-normal">
                  Cost {CHASE_FIAT_COST.toLocaleString()} coins · collect for score
                </span>
              </span>
              <Coins className="size-5" />
            </Button>
            {!canPlayFiat && (
              <p className="text-xs text-destructive text-center -mt-2">
                Not enough coins. Fiat games cost {CHASE_FIAT_COST.toLocaleString()} coins.
              </p>
            )}

            <Button
              size="lg"
              variant="outline"
              className="w-full justify-between h-auto py-4"
              onClick={() => onStart('sats')}
              disabled={!allowSatsMode}
            >
              <span className="flex flex-col items-start">
                <span className="font-semibold">{allowSatsMode ? 'Play for ₿AO Sats' : '₿AO Sats disabled'}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {allowSatsMode
                    ? `Free to play · ${CHASE_SATS_PER_COIN} sats per coin collected`
                    : 'Switch to ₿AO signet mode to play for demo sats.'}
                </span>
              </span>
              <Zap className="size-5" />
            </Button>
          </div>

          <div className="rounded-xl border bg-muted/40 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Info className="size-3.5" />
              <span>Controls</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-background px-2 py-1.5 border">Space / ↑ / Tap to jump</div>
              <div className="rounded-lg bg-background px-2 py-1.5 border">↓ to duck</div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {CHASE_RAILS.map((rail) => (
              <div
                key={rail.id}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold border"
                style={{ backgroundColor: rail.bg, color: rail.color, borderColor: rail.color }}
              >
                <span>{rail.icon}</span>
                <span>{rail.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
