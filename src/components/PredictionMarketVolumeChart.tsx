import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { useBaoMarketVolume, type VolumeRange } from '@/hooks/useBaoMarketVolume';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { BaoMarket } from '@/lib/baoMarketParser';

const TIME_RANGES: VolumeRange[] = ['1H', '1D', '1W', '1M', 'ALL'];

function formatSats(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

function formatTime(value: number): string {
  const date = new Date(value * 1000);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface PredictionMarketVolumeChartProps {
  market: BaoMarket;
  className?: string;
}

export function PredictionMarketVolumeChart({ market, className }: PredictionMarketVolumeChartProps) {
  const [range, setRange] = useState<VolumeRange>('ALL');
  const { data, isLoading, error } = useBaoMarketVolume(market.marketId, range);

  const chartData = useMemo(() => {
    if (!data?.buckets) return [];
    return data.buckets.map((bucket) => ({
      time: bucket.time,
      volume: bucket.volume,
    }));
  }, [data]);

  const totalVolume = useMemo(() => {
    return chartData.reduce((sum, d) => sum + d.volume, 0);
  }, [chartData]);

  if (isLoading) {
    return <Skeleton className={cn('h-80 w-full rounded-xl', className)} />;
  }

  if (error) {
    return (
      <div
        className={cn(
          'h-80 w-full rounded-xl border border-border flex items-center justify-center text-sm text-muted-foreground',
          className,
        )}
      >
        Could not load volume data.
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div
        className={cn(
          'h-80 w-full rounded-xl border border-border flex items-center justify-center text-sm text-muted-foreground',
          className,
        )}
      >
        No volume data available.
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <span className="text-sm font-semibold text-[var(--2140-fg)]">Volume</span>
          <p className="text-xs text-[var(--2140-muted)]">
            {formatSats(totalVolume)} sats traded
          </p>
        </div>
      </div>

      <div className="h-80 w-full rounded-xl border border-[var(--2140-border)] bg-[var(--2140-surface)] p-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatTime}
              tick={{ fontSize: 10, fill: 'var(--2140-muted)' }}
              stroke="var(--2140-border)"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={formatSats}
              tick={{ fontSize: 10, fill: 'var(--2140-muted)' }}
              stroke="var(--2140-border)"
              width={50}
            />
            <Tooltip
              labelFormatter={(value: number) => formatTime(value)}
              formatter={(value: number) => [`${formatSats(value)} sats`, 'Volume']}
              contentStyle={{
                backgroundColor: 'var(--2140-surface)',
                borderColor: 'var(--2140-border)',
                color: 'var(--2140-fg)',
              }}
            />
            <Bar
              dataKey="volume"
              fill="var(--2140-bitcoin)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-1">
        {TIME_RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
              range === r
                ? 'bg-[var(--2140-bitcoin)] text-black'
                : 'bg-[var(--2140-surface)] text-[var(--2140-muted)] border border-[var(--2140-border)] hover:border-[var(--2140-border-hover)] hover:text-[var(--2140-fg)]',
            )}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
