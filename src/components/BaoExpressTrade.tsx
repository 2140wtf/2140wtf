import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { placeBaoTrade } from '@/lib/baoFundraising';
import { cn } from '@/lib/utils';
import type { BaoMarket } from '@/lib/baoMarketParser';

const AMOUNT_PRESETS = [1_000, 2_140, 5_000, 10_000, 21_400, 100_000];

const RAILS = [
  { id: 'lightning', label: 'Lightning', hint: 'Instant settlement via HTLC' },
  { id: 'cashu', label: 'Cashu', hint: 'Instant, private ecash' },
  { id: 'onchain', label: 'On-Chain', hint: 'Verified on ₿AO signet network' },
  { id: 'liquid', label: 'Liquid', hint: 'Min 1,000 sats. Covenant settlement' },
] as const;

function formatSats(n: number): string {
  return n.toLocaleString();
}

interface BaoExpressTradeProps {
  market: BaoMarket;
  /** Outcome label to preselect (e.g. from a Buy Yes / Buy No card button). */
  initialOutcomeLabel?: string | null;
  /** Called after a trade is placed successfully (e.g. to refresh odds). */
  onTraded?: () => void;
}

/**
 * Express Trade module — the fast path for ₿AO markets: pick a side, an
 * amount (with presets), a rail, done. Orders go straight to the bao.markets
 * API with the user's signer (NIP-98), so no separate bao.markets login is
 * needed. Demo deployment: orders settle in free signet sats.
 */
export function BaoExpressTrade({ market, initialOutcomeLabel, onTraded }: BaoExpressTradeProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const binary = market.outcomes.length === 2;
  const [outcomeIdx, setOutcomeIdx] = useState(() => {
    if (initialOutcomeLabel) {
      const idx = market.outcomes.findIndex(
        (o) => o.label.toLowerCase() === initialOutcomeLabel.toLowerCase(),
      );
      if (idx >= 0) return idx;
    }
    return 0;
  });
  const [amount, setAmount] = useState('2140');
  const [rail, setRail] = useState<string>('cashu');

  const outcome = market.outcomes[outcomeIdx];
  const amountSats = useMemo(() => parseInt(amount, 10) || 0, [amount]);

  const trade = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Log in to trade.');
      if (!outcome) throw new Error('Pick an outcome.');
      if (amountSats < 1) throw new Error('Enter an amount in sats.');
      return placeBaoTrade(user.signer, {
        marketId: market.marketId,
        outcomeId: outcome.id,
        outcomeLabel: outcome.label,
        amountSats,
        rail,
      });
    },
    onSuccess: (result) => {
      toast({
        title: 'Trade placed',
        description: `${formatSats(amountSats)} sats on ${outcome.label} (${result.via.toUpperCase()} pool).`,
      });
      onTraded?.();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        title: 'Trade failed',
        description: /insufficient|balance/i.test(msg)
          ? `${msg} — claim free demo sats on bao.markets first.`
          : msg,
        variant: 'destructive',
      });
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Express Trade</p>
        {outcome && (
          <Badge variant="outline" className={cn('text-xs', outcome.label.toLowerCase() === 'no' && 'border-destructive/50 text-destructive')}>
            Trading on: {outcome.label}
          </Badge>
        )}
      </div>

      {/* Outcome picker */}
      {binary ? (
        <div className="grid grid-cols-2 gap-2">
          {market.outcomes.map((o, i) => (
            <Button
              key={o.id}
              type="button"
              variant={i === outcomeIdx ? 'default' : 'outline'}
              className="w-full"
              onClick={() => setOutcomeIdx(i)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {market.outcomes.map((o, i) => (
            <Button
              key={o.id}
              type="button"
              size="sm"
              variant={i === outcomeIdx ? 'default' : 'outline'}
              onClick={() => setOutcomeIdx(i)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}

      {/* Amount + presets */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide" htmlFor="trade-amount">
          Amount (sats)
        </label>
        <Input
          id="trade-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          className="text-lg font-semibold"
        />
        <div className="flex flex-wrap gap-1.5">
          {AMOUNT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmount(String(preset))}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs tabular-nums transition-colors',
                amountSats === preset
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/50',
              )}
            >
              {formatSats(preset)}
            </button>
          ))}
        </div>
      </div>

      {/* Demo notice */}
      <div className="flex items-start gap-2 rounded-md border border-amber-500/60 bg-card px-3 py-2 text-foreground">
        <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
        <p className="text-[11px] leading-relaxed text-foreground">
          Demo Mode — using ₿AO Signet sats, not real Bitcoin.
        </p>
      </div>

      {/* Rails */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pay with</p>
        <div className="grid grid-cols-2 gap-2">
          {RAILS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRail(r.id)}
              className={cn(
                'rounded-lg border p-2.5 text-left transition-colors',
                rail === r.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50',
              )}
            >
              <p className="text-sm font-medium">{r.label}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{r.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <Button
        className="w-full h-11 text-base gap-2"
        disabled={trade.isPending || !user || amountSats < 1 || !outcome}
        onClick={() => trade.mutate()}
      >
        {trade.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Zap className="size-4" />
        )}
        {user ? 'Place Trade' : 'Log in to trade'}
      </Button>
    </div>
  );
}
