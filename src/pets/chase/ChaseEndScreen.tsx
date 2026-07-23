import { useState } from 'react';
import { Coins, Zap, RotateCcw, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { type ChaseMode, type ChaseRunResult, CHASE_RAILS, CHASE_SATS_PER_COIN } from './types';

interface ChaseEndScreenProps {
  result: ChaseRunResult;
  mode: ChaseMode;
  onRetry: () => void;
  onExit: () => void;
  onClaimSats?: () => Promise<{ success: boolean; claimedAmount: number; message?: string }>;
  isClaiming?: boolean;
}

export function ChaseEndScreen({
  result,
  mode,
  onRetry,
  onExit,
  onClaimSats,
  isClaiming,
}: ChaseEndScreenProps) {
  const [claimResult, setClaimResult] = useState<{ claimed: number; message?: string } | null>(null);

  const handleClaim = async () => {
    if (!onClaimSats) return;
    const res = await onClaimSats();
    if (res.success) {
      setClaimResult({ claimed: res.claimedAmount, message: res.message });
    } else {
      setClaimResult({ claimed: 0, message: res.message ?? 'Claim failed' });
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm z-20">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto size-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            {mode === 'sats' ? <Zap className="size-7 text-primary" /> : <Coins className="size-7 text-primary" />}
          </div>
          <CardTitle className="text-2xl">Run Complete</CardTitle>
          <CardDescription>
            {mode === 'sats'
              ? 'You collected coins across the ₿AO payment rails.'
              : 'Your fiat coin run is in the books.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border bg-muted/40 p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Score</div>
              <div className="text-lg font-bold">{result.score.toLocaleString()}</div>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Distance</div>
              <div className="text-lg font-bold">{Math.floor(result.distance).toLocaleString()}m</div>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Coins</div>
              <div className="text-lg font-bold">{result.coinsCollected}</div>
            </div>
          </div>

          {mode === 'sats' && (
            <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/20 p-4 text-center space-y-1">
              <div className="text-xs text-muted-foreground">Demo sats won</div>
              <div className="text-3xl font-bold text-amber-600">{result.satsWon.toLocaleString()} sats</div>
              <div className="text-xs text-muted-foreground">{CHASE_SATS_PER_COIN} sats per coin</div>
            </div>
          )}

          {result.coinsCollected > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {CHASE_RAILS.map((rail) => {
                const count = result.coinsByRail[rail.id] ?? 0;
                if (count === 0) return null;
                return (
                  <div
                    key={rail.id}
                    className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold border"
                    style={{ backgroundColor: rail.bg, color: rail.color, borderColor: rail.color }}
                  >
                    <span>{rail.icon}</span>
                    <span>{rail.label}</span>
                    <span className="opacity-70">{count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {claimResult && (
            <Alert variant={claimResult.claimed > 0 ? 'default' : 'destructive'}>
              <AlertCircle className="size-4" />
              <AlertDescription>
                {claimResult.claimed > 0
                  ? `Claimed ${claimResult.claimed.toLocaleString()} demo sats to your ₿AO wallet.`
                  : claimResult.message ?? 'Claim failed.'}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {mode === 'sats' && !claimResult && onClaimSats && (
              <Button
                size="lg"
                className="w-full"
                onClick={handleClaim}
                disabled={result.satsWon <= 0 || isClaiming}
              >
                {isClaiming ? <Loader2 className="size-4 animate-spin mr-2" /> : <Zap className="size-4 mr-2" />}
                Claim Cashu
              </Button>
            )}
            <Button size="lg" variant="outline" className="w-full" onClick={onRetry}>
              <RotateCcw className="size-4 mr-2" />
              Retry
            </Button>
            <Button size="lg" variant="ghost" className="w-full" onClick={onExit}>
              <ArrowLeft className="size-4 mr-2" />
              Exit
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
