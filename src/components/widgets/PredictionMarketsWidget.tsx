import { BarChart3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { BaoMarket } from '@/lib/baoMarketParser';

function formatProbability(prob: number): string {
  if (!Number.isFinite(prob)) return '—';
  return `${Math.round(prob * 100)}%`;
}

function formatEndDate(timestamp: number): string {
  if (!timestamp || timestamp <= 0) return 'No end date';
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getOutcomeColor(label: string): { text: string; indicator?: string } {
  const normalized = label.trim().toLowerCase();
  if (normalized === 'yes') {
    return { text: 'text-green-500', indicator: 'bg-green-500' };
  }
  if (normalized === 'no') {
    return { text: 'text-[var(--2140-bitcoin)]' };
  }
  return { text: 'text-muted-foreground' };
}

/** Compact prediction-markets widget for the right sidebar.
 *
 *  Reads cached market data without triggering a BAO relay fetch.
 *  Clicking a market opens its detail popup on the prediction-markets page.
 */
export function PredictionMarketsWidget() {
  const { data: markets = [] } = useQuery<BaoMarket[]>({
    queryKey: ['bao-prediction-markets', 'all'],
    enabled: false,
  });

  const visibleMarkets = markets.slice(0, 5);

  if (visibleMarkets.length === 0) {
    return (
      <div className="space-y-3 p-1">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">₿AO MARKETS</h3>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Explore prediction markets powered by ₿AO MARKETS. All markets are for play only with
          dummy bitcoin in demo mode — claim testnet bitcoin by visiting{' '}
          <a
            href="https://bao.markets"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            https://bao.markets
          </a>
          .
        </p>

        <Link to="/prediction-markets" className="text-xs text-primary hover:underline">
          View all markets
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">₿AO MARKETS</h3>
      </div>

      <div className="space-y-3">
        {visibleMarkets.map((market) => (
          <Link
            key={market.marketId}
            to={`/prediction-markets?market=${encodeURIComponent(market.marketId)}`}
            className="block group hover:bg-secondary/40 px-2 py-1.5 -mx-2 rounded-lg transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                {market.title}
              </p>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                {market.category}
              </Badge>
            </div>

            {market.outcomes.slice(0, 2).map((outcome) => {
              const color = getOutcomeColor(outcome.label);
              return (
                <div key={outcome.id} className="mt-1.5 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className={cn('truncate max-w-[65%]', color.text)}>
                      {outcome.label}
                    </span>
                    <span className="text-muted-foreground">
                      {formatProbability(outcome.probability)}
                    </span>
                  </div>
                  <Progress
                    value={Math.max(0, Math.min(100, (outcome.probability || 0) * 100))}
                    className="h-1"
                    indicatorClassName={color.indicator}
                  />
                </div>
              );
            })}

            <p className="mt-1 text-[10px] text-muted-foreground">
              Ends {formatEndDate(market.endTime)}
            </p>
          </Link>
        ))}
      </div>

      <div className="pt-1">
        <Link to="/prediction-markets" className="text-xs text-primary hover:underline">
          View all markets
        </Link>
      </div>
    </div>
  );
}
