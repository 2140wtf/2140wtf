import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchMiniMarketHistory, type MiniHistoryPoint } from '@/lib/baoMiniHistory';
import type { BaoMarket } from '@/lib/baoMarketParser';

function pointsToPolyline(points: MiniHistoryPoint[]): string {
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min;
  return points.map((point, index) => {
    const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
    const y = spread === 0 ? 15 : 28 - ((point.price - min) / spread) * 26;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

export function MarketMiniSparkline({ market }: { market: BaoMarket }) {
  const ref = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || nearViewport) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setNearViewport(true); },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [nearViewport]);

  const firstOutcomeId = market.outcomes[0]?.id;
  const history = useQuery({
    queryKey: ['bao-market-mini-history', market.marketId, firstOutcomeId, '7d'],
    queryFn: ({ signal }) => fetchMiniMarketHistory(market, signal),
    enabled: nearViewport && !!firstOutcomeId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const points = history.data ?? [];

  return (
    <div ref={ref} className="h-8" aria-label="Seven-day market price history">
      {points.length >= 2 ? (
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full" role="img">
          <title>Real seven-day price history</title>
          <polyline
            points={pointsToPolyline(points)}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            className="text-emerald-500"
          />
        </svg>
      ) : history.isFetched ? (
        <span className="text-[11px] italic text-muted-foreground">History unavailable</span>
      ) : null}
    </div>
  );
}
