import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { useBaoMarketPriceHistory, type PricePoint, type PriceHistoryRange } from '@/hooks/useBaoMarketPriceHistory';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { synthesizeBaoSparkline } from '@/lib/synthesizeBaoSparkline';
import type { BaoMarket } from '@/lib/baoMarketParser';

type TimeRange = PriceHistoryRange;

const TIME_RANGES: TimeRange[] = ['1H', '1D', '1W', '1M', 'ALL'];

const RANGE_DURATIONS: Record<TimeRange, number> = {
  '1H': 60 * 60,
  '1D': 24 * 60 * 60,
  '1W': 7 * 24 * 60 * 60,
  '1M': 30 * 24 * 60 * 60,
  'ALL': Infinity,
};

const RANGE_BUCKETS: Record<TimeRange, number> = {
  '1H': 60,          // 1 minute
  '1D': 5 * 60,      // 5 minutes
  '1W': 60 * 60,     // 1 hour
  '1M': 4 * 60 * 60, // 4 hours
  'ALL': 24 * 60 * 60, // 1 day
};

const OUTCOME_COLORS = [
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#22c55e', // green
  '#ef4444', // red
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // violet
];

function outcomeColor(outcome: { label: string }, index: number): string {
  const normalized = outcome.label.trim().toLowerCase();
  if (normalized === 'yes') return '#22c55e';
  if (normalized === 'no') return 'var(--2140-bitcoin)';
  return OUTCOME_COLORS[index % OUTCOME_COLORS.length];
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
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

interface ChartRow {
  time: number;
  [key: string]: number;
}

function aggregateHistory(
  history: Record<string, PricePoint[]>,
  market: BaoMarket,
  range: TimeRange,
): { data: ChartRow[]; series: string[]; current: Record<string, number> } {
  const outcomes = market.outcomes;
  const now = Math.floor(Date.now() / 1000);
  const duration = RANGE_DURATIONS[range];
  const bucketSize = RANGE_BUCKETS[range];
  const MAX_BUCKETS = 365;

  const allTimes: number[] = [];
  for (const points of Object.values(history)) {
    for (const p of points) allTimes.push(p.time);
  }

  const hasHistory = allTimes.length > 0;
  const minTime = hasHistory ? Math.min(...allTimes) : 0;
  const endTime = now;

  let startTime: number;
  if (hasHistory) {
    startTime = range === 'ALL' ? minTime : Math.max(minTime, now - duration);
  } else {
    // No trade history yet — mirror bao.markets and synthesize a seeded
    // random-walk sparkline so the chart is never empty.
    if (range === 'ALL' && market.createdAt > 0 && market.createdAt <= now) {
      startTime = market.createdAt;
    } else {
      startTime = now - duration;
    }
  }

  // Defensive: malformed timestamps or future dates would produce an invalid
  // window. Fall back to the last 24 hours so the chart still renders.
  if (!Number.isFinite(startTime) || startTime >= now) {
    startTime = now - Math.min(duration, 24 * 60 * 60);
  }

  // Cap the ALL window to avoid thousands of empty buckets.
  if (range === 'ALL' && (endTime - startTime) / bucketSize > MAX_BUCKETS) {
    startTime = endTime - MAX_BUCKETS * bucketSize;
  }

  const series: string[] = [];
  const current: Record<string, number> = {};
  const perSeries: Record<string, { time: number; value: number }[]> = {};

  if (!hasHistory) {
    const span = Math.max(1, endTime - startTime);
    let bucketCount = Math.max(2, Math.ceil(span / bucketSize));
    if (bucketCount > 100) bucketCount = 100;
    const step = span / (bucketCount - 1);

    let yesValues: number[] | null = null;

    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      const key = outcome.label;
      series.push(key);

      const targetProb = Math.max(0, Math.min(1, outcome.probability ?? 1 / outcomes.length));

      let values: number[];
      if (outcomes.length === 2 && i === 0) {
        yesValues = synthesizeBaoSparkline(targetProb, market.marketId, bucketCount);
        values = yesValues;
      } else if (outcomes.length === 2 && i === 1 && yesValues) {
        values = yesValues.map((v) => 1 - v);
      } else {
        values = synthesizeBaoSparkline(targetProb, `${market.marketId}:${outcome.label}`, bucketCount);
      }

      const buckets: { time: number; value: number }[] = [];
      for (let j = 0; j < bucketCount; j++) {
        buckets.push({ time: Math.floor(startTime + j * step), value: values[j] });
      }

      perSeries[key] = buckets;
      current[key] = values[values.length - 1];
    }
  } else {
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      const key = outcome.label;
      series.push(key);

      const points = history[key] ?? history[outcome.id] ?? [];
      const sorted = [...points].sort((a, b) => a.time - b.time);

      // Default probability if we have no history for this outcome.
      const defaultProb = Math.max(0, Math.min(1, outcome.probability ?? 1 / outcomes.length));

      const buckets: { time: number; value: number }[] = [];
      let lastPrice = defaultProb;
      let pointIdx = 0;

      // Start with a point at the window start using the earliest known price.
      for (const p of sorted) {
        if (p.time <= startTime) lastPrice = p.price;
        else break;
      }

      for (let t = startTime; t <= endTime; t += bucketSize) {
        const bucketEnd = t + bucketSize;
        while (pointIdx < sorted.length && sorted[pointIdx].time < bucketEnd) {
          lastPrice = sorted[pointIdx].price;
          pointIdx++;
        }
        buckets.push({ time: t, value: lastPrice });
      }

      // Ensure the final current price is reflected at the end of the window.
      if (buckets.length === 0 || buckets[buckets.length - 1].time < endTime) {
        buckets.push({ time: endTime, value: lastPrice });
      }

      perSeries[key] = buckets;
      current[key] = lastPrice;
    }
  }

  // Merge all series into rows keyed by time.
  const rowMap = new Map<number, ChartRow>();
  for (const key of series) {
    for (const p of perSeries[key]) {
      const row = rowMap.get(p.time) ?? { time: p.time };
      row[key] = p.value;
      rowMap.set(p.time, row);
    }
  }

  const data = Array.from(rowMap.values()).sort((a, b) => a.time - b.time);
  return { data, series, current };
}

interface PredictionMarketChartProps {
  market: BaoMarket;
  className?: string;
}

export function PredictionMarketChart({ market, className }: PredictionMarketChartProps) {
  const [range, setRange] = useState<TimeRange>('ALL');
  const { data: history = {}, isLoading, error } = useBaoMarketPriceHistory(market, range);

  const { data, series, current } = useMemo(
    () => aggregateHistory(history, market, range),
    [history, market, range],
  );

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
        Could not load chart data.
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        className={cn(
          'h-80 w-full rounded-xl border border-border flex items-center justify-center text-sm text-muted-foreground',
          className,
        )}
      >
        No trades yet. Price history will appear once trading begins.
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[var(--2140-fg)]">Price History</span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {market.outcomes.map((outcome, idx) => {
            const color = outcomeColor(outcome, idx);
            return (
              <div
                key={outcome.id}
                className="flex items-center gap-1.5 rounded-md border border-[var(--2140-border)] bg-[var(--2140-surface)] px-2 py-1 text-xs"
              >
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-[var(--2140-muted)]">{outcome.label}</span>
                <span className="font-semibold text-[var(--2140-fg)]">
                  {formatPercent(current[outcome.label] ?? outcome.probability ?? 0)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="h-80 w-full rounded-xl border border-[var(--2140-border)] bg-[var(--2140-surface)] p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
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
              domain={[0, 1]}
              tickFormatter={formatPercent}
              tick={{ fontSize: 10, fill: 'var(--2140-muted)' }}
              stroke="var(--2140-border)"
              width={40}
            />
            <Tooltip
              labelFormatter={(value: number) => formatTime(value)}
              formatter={(value: number, name: string) => [formatPercent(value), name]}
              contentStyle={{
                backgroundColor: 'var(--2140-surface)',
                borderColor: 'var(--2140-border)',
                color: 'var(--2140-fg)',
              }}
            />
            <defs>
              {series.map((key, idx) => {
                const color = outcomeColor(market.outcomes[idx], idx);
                return (
                  <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                );
              })}
            </defs>
            {series.map((key) => (
              <Area
                key={`area-${key}`}
                type="stepAfter"
                dataKey={key}
                stroke="none"
                fill={`url(#fill-${key})`}
                isAnimationActive={false}
              />
            ))}
            {series.map((key, idx) => {
              const color = outcomeColor(market.outcomes[idx], idx);
              return (
                <Line
                  key={`line-${key}`}
                  type="stepAfter"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
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
