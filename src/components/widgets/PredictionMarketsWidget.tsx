import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';

import { useBaoTopPredictionMarkets } from '@/hooks/useBaoTopPredictionMarkets';
import { BaoMarketDetailDialog } from '@/components/BaoMarketDetailDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BaoMarket } from '@/lib/baoMarketParser';

const ROTATION_INTERVAL_MS = 2 * 60 * 1000;
const MARKETS_PER_VIEW = 4;

/**
 * Compact ₿AO MARKETS widget for the right sidebar.
 *
 * Shows the highest-volume active markets from the BAO API, falling back to
 * active markets from the relay if the API is unavailable. Ended markets are
 * intentionally not shown here; use the full ₿AO MARKETS page for historical
 * markets.
 */
export function PredictionMarketsWidget() {
  const { data: markets = [], isLoading } = useBaoTopPredictionMarkets();
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedMarket, setSelectedMarket] = useState<BaoMarket | null>(null);

  const displayedMarkets = useMemo(() => {
    const pageCount = Math.max(1, Math.ceil(markets.length / MARKETS_PER_VIEW));
    const clampedPage = Math.min(pageIndex, pageCount - 1);
    const start = clampedPage * MARKETS_PER_VIEW;
    return markets.slice(start, start + MARKETS_PER_VIEW);
  }, [markets, pageIndex]);

  const pageCount = Math.max(1, Math.ceil(markets.length / MARKETS_PER_VIEW));

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
          {market.state !== 'active' && (
            <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 shrink-0">
              {market.state}
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
