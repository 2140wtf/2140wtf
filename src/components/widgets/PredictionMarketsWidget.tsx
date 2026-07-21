import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';

import { useBaoPredictionMarkets } from '@/hooks/useBaoPredictionMarkets';
import { BaoMarketDetailDialog } from '@/components/BaoMarketDetailDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BaoMarket } from '@/lib/baoMarketParser';

const ROTATION_INTERVAL_MS = 2 * 60 * 1000;
const MARKETS_PER_VIEW = 4;

function isMarketActive(market: BaoMarket, now: number): boolean {
  return market.state === 'active' && (market.endTime <= 0 || market.endTime >= now);
}

/**
 * Compact ₿AO MARKETS widget for the right sidebar.
 *
 * Rotates through active market titles every 2 minutes. If there are no active
 * markets, falls back to the most recent markets so the widget never looks
 * broken. Clicking a market opens its chart/details.
 */
export function PredictionMarketsWidget() {
  const { data: markets = [], isLoading } = useBaoPredictionMarkets('all');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedMarket, setSelectedMarket] = useState<BaoMarket | null>(null);

  const now = Math.floor(Date.now() / 1000);
  const activeMarkets = useMemo(
    () => markets.filter((m) => isMarketActive(m, now)),
    [markets, now],
  );

  // Fallback: if nothing is active, show the latest markets so the widget
  // doesn't sit empty when all current markets have already ended.
  const displayedMarkets = useMemo(() => {
    const source = activeMarkets.length > 0 ? activeMarkets : markets.slice(0, MARKETS_PER_VIEW);
    const pageCount = Math.max(1, Math.ceil(source.length / MARKETS_PER_VIEW));
    const clampedPage = Math.min(pageIndex, pageCount - 1);
    const start = clampedPage * MARKETS_PER_VIEW;
    return source.slice(start, start + MARKETS_PER_VIEW);
  }, [activeMarkets, markets, pageIndex]);

  const pageCount = Math.max(
    1,
    Math.ceil(
      (activeMarkets.length > 0 ? activeMarkets.length : Math.min(markets.length, MARKETS_PER_VIEW)) /
        MARKETS_PER_VIEW,
    ),
  );

  // Clamp the page index when the market list shrinks.
  useEffect(() => {
    setPageIndex((prev) => (prev >= pageCount ? 0 : prev));
  }, [pageCount]);

  // Rotate through markets every 2 minutes.
  useEffect(() => {
    if (displayedMarkets.length <= MARKETS_PER_VIEW) return;
    const timer = setInterval(() => {
      setPageIndex((prev) => (prev + 1) % pageCount);
    }, ROTATION_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [displayedMarkets.length, pageCount]);

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        {Array.from({ length: MARKETS_PER_VIEW }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="p-1 text-xs text-muted-foreground">
        No markets found right now.
        {' '}
        <Link to="/prediction-markets" className="text-primary hover:underline">
          View all markets
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-1">
      {displayedMarkets.map((market) => (
        <button
          key={market.marketId}
          type="button"
          onClick={() => setSelectedMarket(market)}
          className={cn(
            'w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg',
            'bg-secondary/40 hover:bg-secondary/70 transition-colors',
          )}
        >
          <TrendingUp className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium line-clamp-3 leading-snug">
            {market.title}
          </span>
          {!isMarketActive(market, now) && (
            <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 shrink-0">
              Ended
            </Badge>
          )}
        </button>
      ))}

      <div className="pt-1">
        <Link
          to="/prediction-markets"
          className="text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          View all markets →
        </Link>
      </div>

      <BaoMarketDetailDialog
        market={selectedMarket}
        open={!!selectedMarket}
        onOpenChange={(open) => {
          if (!open) setSelectedMarket(null);
        }}
      />
    </div>
  );
}
