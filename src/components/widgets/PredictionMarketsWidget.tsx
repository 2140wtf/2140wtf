import { useEffect, useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';

import { useBaoPredictionMarkets } from '@/hooks/useBaoPredictionMarkets';
import { BaoMarketDetailDialog } from '@/components/BaoMarketDetailDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { BaoMarket } from '@/lib/baoMarketParser';

const ROTATION_INTERVAL_MS = 2 * 60 * 1000;
const MARKETS_PER_VIEW = 2;

/**
 * Compact ₿AO MARKETS widget for the right sidebar.
 *
 * Shows only the widget title (rendered by WidgetCard) and rotates two active
 * market titles every 2 minutes. Clicking a market opens its chart/details.
 */
export function PredictionMarketsWidget() {
  const { data: markets = [], isLoading } = useBaoPredictionMarkets('all');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedMarket, setSelectedMarket] = useState<BaoMarket | null>(null);

  const now = Math.floor(Date.now() / 1000);
  const activeMarkets = useMemo(
    () => markets.filter((m) => m.state === 'active' && (m.endTime <= 0 || m.endTime >= now)),
    [markets, now],
  );

  const pageCount = Math.max(1, Math.ceil(activeMarkets.length / MARKETS_PER_VIEW));

  // Clamp the page index when the market list shrinks.
  useEffect(() => {
    setPageIndex((prev) => (prev >= pageCount ? 0 : prev));
  }, [pageCount]);

  // Rotate through active markets every 2 minutes.
  useEffect(() => {
    if (activeMarkets.length <= MARKETS_PER_VIEW) return;
    const timer = setInterval(() => {
      setPageIndex((prev) => (prev + 1) % pageCount);
    }, ROTATION_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeMarkets.length, pageCount]);

  const displayedMarkets = useMemo(() => {
    const start = pageIndex * MARKETS_PER_VIEW;
    return activeMarkets.slice(start, start + MARKETS_PER_VIEW);
  }, [activeMarkets, pageIndex]);

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        {Array.from({ length: MARKETS_PER_VIEW }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (activeMarkets.length === 0) {
    return (
      <div className="p-1 text-xs text-muted-foreground">
        No active markets right now.
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
          <span className="text-sm font-medium line-clamp-2 leading-snug">
            {market.title}
          </span>
        </button>
      ))}

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
