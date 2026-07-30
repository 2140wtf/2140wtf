import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, TrendingUp, TrendingDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useBaoPositions } from '@/hooks/useBaoPositions';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import type { BaoPosition } from '@/lib/baoWalletApi';
import { cn } from '@/lib/utils';
import type { BaoMarket } from '@/lib/baoMarketParser';

function formatSats(n: number): string {
  return n.toLocaleString();
}

interface MyTradesSectionProps {
  /** Open a market (same dialog as the grid). */
  onOpenMarket: (market: BaoMarket | null, position: BaoPosition) => void;
}

/**
 * "My trades" — the logged-in user's open positions on bao.markets, above
 * the market grid. Each row links into the market detail. Hidden entirely
 * when logged out or when there are no positions yet.
 */
export function MyTradesSection({ onOpenMarket }: MyTradesSectionProps) {
  const { user } = useCurrentUser();
  const positions = useBaoPositions();
  const [expanded, setExpanded] = useState(true);

  if (!user) return null;
  const list = positions.data ?? [];
  if (positions.isSuccess && list.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-sm font-semibold flex-1">
          My trades
          {list.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {list.length} open position{list.length === 1 ? '' : 's'}
            </span>
          )}
        </span>
        {positions.isFetching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {positions.isLoading ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">Loading your positions…</p>
          ) : positions.isError ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              Couldn't load your positions from bao.markets.
            </p>
          ) : (
            list.map((position) => (
              <PositionRow key={`${position.market_id}:${position.outcome_id}`} position={position} onOpen={() => onOpenMarket(null, position)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PositionRow({ position, onOpen }: { position: BaoPosition; onOpen: () => void }) {
  const pnl = position.unrealized_pnl;
  const pnlPositive = pnl >= 0;
  const entryPct = Math.round(position.avg_price * 100);
  const currentPct = position.current_price !== undefined ? Math.round(position.current_price * 100) : undefined;

  return (
    <Button
      variant="outline"
      className="w-full h-auto justify-start gap-3 px-3 py-2.5 text-left"
      onClick={onOpen}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug line-clamp-1">
          {position.market_title ?? position.market_id}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {position.outcome_id} · {formatSats(position.size)} sats @ {entryPct}%
          {currentPct !== undefined && ` → ${currentPct}%`}
        </p>
      </div>
      <span
        className={cn(
          'flex items-center gap-1 text-xs font-semibold tabular-nums shrink-0',
          pnlPositive ? 'text-green-600 dark:text-green-400' : 'text-destructive',
        )}
      >
        {pnlPositive ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
        {pnlPositive ? '+' : ''}{formatSats(pnl)}
      </span>
    </Button>
  );
}
