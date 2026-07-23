import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, createTextWatermark, IChartApi, ISeriesApi, Time, LineSeries } from 'lightweight-charts';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

import { useAppContext } from '@/hooks/useAppContext';
import { useBaoMarketPriceHistory, type PriceHistoryRange } from '@/hooks/useBaoMarketPriceHistory';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { hslStringToHex } from '@/lib/colorUtils';
import { synthesizeBaoSparkline } from '@/lib/synthesizeBaoSparkline';
import type { BaoMarket } from '@/lib/baoMarketParser';

const TIME_RANGES: PriceHistoryRange[] = ['1H', '1D', '1W', '1M', 'ALL'];

/** Polymarket-style outcome line colours (bao.markets palette). */
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

interface ChartPoint {
  time: number;
  value: number;
}

interface OutcomeChartData {
  outcomeId: string;
  label: string;
  color: string;
  areaData: ChartPoint[];
  currentPrice: number;
  priceChangePercent: number;
}

function getOutcomeColor(outcome: BaoMarket['outcomes'][number], index: number): string {
  const normalized = outcome.label.trim().toLowerCase();
  if (normalized === 'yes') return '#22c55e';
  if (normalized === 'no') return '#ef4444';
  return OUTCOME_COLORS[index % OUTCOME_COLORS.length];
}

function formatTimeLeft(endTime: number): string {
  if (!Number.isFinite(endTime)) return 'Ended';
  const now = Date.now();
  const diff = endTime * 1000 - now;
  if (diff <= 0) return 'Ended';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 30) return `${Math.floor(days / 30)}mo left`;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return 'Ending soon';
}

function computeOutcomeData(
  outcome: BaoMarket['outcomes'][number],
  historyPoints: Array<{ time: number; price: number }> | undefined,
  marketId: string,
  range: PriceHistoryRange,
  color: string,
  mirroredValues?: number[],
): OutcomeChartData {
  const fallbackProb = outcome.probability ?? 0.5;
  let areaData: ChartPoint[];

  if (historyPoints && historyPoints.length >= 2) {
    areaData = historyPoints.map((p) => ({ time: p.time, value: p.price * 100 }));
  } else {
    const prob = Math.max(0, Math.min(1, fallbackProb));
    const bucketCount = range === '1H' ? 12 : 20;
    const now = Math.floor(Date.now() / 1000);
    const step = 86400 / (bucketCount - 1);
    const values = mirroredValues
      ? mirroredValues.map((v) => 1 - v)
      : synthesizeBaoSparkline(prob, `${marketId}:${outcome.label}`, bucketCount);
    areaData = values.map((v, i) => ({ time: now - 86400 + Math.floor(i * step), value: v * 100 }));
  }

  const values = areaData.map((p) => p.value);
  const currentPrice = values[values.length - 1] ?? fallbackProb * 100;
  const startPrice = values[0] ?? currentPrice;
  const priceChange = currentPrice - startPrice;
  const priceChangePercent = startPrice > 0 ? (priceChange / startPrice) * 100 : 0;

  return {
    outcomeId: outcome.id,
    label: outcome.label,
    color,
    areaData,
    currentPrice,
    priceChangePercent,
  };
}

function readCssVar(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readCssHslHex(name: string, fallback: string): string {
  const value = readCssVar(name);
  if (!value) return fallback;
  try {
    return hslStringToHex(value);
  } catch {
    return fallback;
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ChartThemeColors {
  text: string;
  grid: string;
  crosshairBg: string;
}

function getChartThemeColors(): ChartThemeColors {
  const text = readCssHslHex('--muted-foreground', '#9ca3af');
  const border = readCssHslHex('--border', '#262626');
  const crosshairBg = readCssHslHex('--card', '#0a0a0a');
  return {
    text,
    grid: hexToRgba(border, 0.12),
    crosshairBg,
  };
}

function addBaoWatermark(chart: IChartApi) {
  try {
    const pane = chart.panes()[0];
    if (!pane) return;
    createTextWatermark(pane, {
      horzAlign: 'right',
      vertAlign: 'bottom',
      lines: [{
        text: '₿AO.markets',
        color: 'rgba(128, 128, 128, 0.08)',
        fontSize: 12,
        fontFamily: 'system-ui, sans-serif',
        fontStyle: '',
      }],
    });
  } catch {
    // Watermark is non-critical.
  }
}

function useSystemDark(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isDark;
}

interface BaoMarketChartProps {
  market: BaoMarket;
  className?: string;
}

export function BaoMarketChart({ market, className }: BaoMarketChartProps) {
  const { config } = useAppContext();
  const [range, setRange] = useState<PriceHistoryRange>('ALL');
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const { data: history = {}, isLoading, error } = useBaoMarketPriceHistory(market, range);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const [isChartReady, setIsChartReady] = useState(false);

  const outcomeData = useMemo<OutcomeChartData[]>(() => {
    const isBinary = market.outcomes.length === 2;
    let yesValues: number[] | undefined;

    return market.outcomes.map((outcome, idx) => {
      const color = getOutcomeColor(outcome, idx);
      const points = history[outcome.label];
      const normalizedLabel = outcome.label.trim().toUpperCase();
      const isNo = isBinary && normalizedLabel === 'NO';

      if (isBinary && normalizedLabel === 'YES') {
        const result = computeOutcomeData(outcome, points, market.marketId, range, color);
        yesValues = result.areaData.map((p) => p.value / 100);
        return result;
      }

      return computeOutcomeData(
        outcome,
        points,
        market.marketId,
        range,
        color,
        isNo ? yesValues : undefined,
      );
    });
  }, [history, market, range]);

  const activeOutcome = useMemo(() => {
    if (selectedOutcome) {
      return outcomeData.find((o) => o.outcomeId === selectedOutcome) ?? outcomeData[0];
    }
    // Default header to YES when present, otherwise the first outcome.
    return outcomeData.find((o) => o.label.trim().toUpperCase() === 'YES') ?? outcomeData[0];
  }, [outcomeData, selectedOutcome]);

  const isUp = (activeOutcome?.priceChangePercent ?? 0) >= 0;
  const systemDark = useSystemDark();
  const themeKey = config.theme === 'system' ? `system:${systemDark}` : config.theme;

  // Initialize / rebuild chart when data, selection, or theme changes.
  useEffect(() => {
    if (!chartContainerRef.current || isLoading) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRefs.current.clear();
    }

    const anyData = outcomeData.some((o) => o.areaData.length > 0);
    if (!anyData) {
      setIsChartReady(false);
      return;
    }

    const colors = getChartThemeColors();
    const height = chartContainerRef.current.clientHeight || 210;
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: colors.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: colors.grid },
      },
      width: chartContainerRef.current.clientWidth,
      height,
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { labelBackgroundColor: colors.crosshairBg },
        horzLine: { labelBackgroundColor: colors.crosshairBg },
      },
      handleScroll: true,
      handleScale: true,
    });

    addBaoWatermark(chart);

    for (const outcome of outcomeData) {
      if (outcome.areaData.length === 0) continue;

      const isHighlighted = !selectedOutcome || selectedOutcome === outcome.outcomeId;
      const dimmedColor = hexToRgba(outcome.color, 0.25);

      const series = chart.addSeries(LineSeries, {
        lineType: 1, // stepped line
        color: isHighlighted ? outcome.color : dimmedColor,
        lineWidth: isHighlighted ? 3 : 1,
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => `${Math.round(price)}%`,
        },
        lastValueVisible: isHighlighted,
        priceLineVisible: false,
        crosshairMarkerVisible: isHighlighted,
        crosshairMarkerRadius: 4,
        lastPriceAnimation: isHighlighted ? 0 : undefined,
      });

      series.setData(
        outcome.areaData.map((p) => ({ time: p.time as Time, value: p.value })),
      );

      seriesRefs.current.set(outcome.outcomeId, series);
    }

    chart.timeScale().fitContent();

    chartRef.current = chart;
    setIsChartReady(true);

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      }, 250);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [outcomeData, isLoading, selectedOutcome, themeKey]);

  // Update data and line styles in place.
  useEffect(() => {
    if (!chartRef.current) return;

    for (const outcome of outcomeData) {
      const series = seriesRefs.current.get(outcome.outcomeId);
      if (!series) continue;

      const isHighlighted = !selectedOutcome || selectedOutcome === outcome.outcomeId;
      const dimmedColor = hexToRgba(outcome.color, 0.25);

      series.setData(
        outcome.areaData.map((p) => ({ time: p.time as Time, value: p.value })),
      );
      series.applyOptions({
        color: isHighlighted ? outcome.color : dimmedColor,
        lineWidth: isHighlighted ? 3 : 1,
        lastValueVisible: isHighlighted,
        crosshairMarkerVisible: isHighlighted,
        lastPriceAnimation: isHighlighted ? 0 : undefined,
      });
    }
  }, [outcomeData, selectedOutcome]);

  const hasData = outcomeData.some((o) => o.areaData.length > 0);

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

  return (
    <div className={cn('space-y-3', className)}>
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div>
            <div className="text-2xl sm:text-3xl font-bold text-card-foreground">
              {activeOutcome ? `${Math.round(activeOutcome.currentPrice)}%` : '—'}
            </div>
            <div
              className={cn(
                'flex items-center gap-1 text-xs sm:text-sm',
                isUp ? 'text-green-500' : 'text-red-500',
              )}
            >
              {isUp ? (
                <TrendingUp className="size-3 sm:size-3.5" />
              ) : (
                <TrendingDown className="size-3 sm:size-3.5" />
              )}
              <span>
                {isUp ? '+' : ''}
                {activeOutcome?.priceChangePercent.toFixed(1) ?? '0.0'}%
              </span>
            </div>
          </div>
          <div className="text-right text-[11px] sm:text-sm text-muted-foreground">
            {market.endTime && <div>{formatTimeLeft(market.endTime)}</div>}
          </div>
        </div>

        {/* Chart */}
        {!hasData ? (
          <div className="h-[170px] sm:h-[190px] md:h-[210px] rounded-lg flex flex-col items-center justify-center bg-muted/30">
            <BarChart3 className="size-6 sm:size-8 text-muted-foreground mb-1.5 sm:mb-2" />
            <p className="text-xs sm:text-sm text-muted-foreground">No trade history yet</p>
          </div>
        ) : (
          <div
            ref={chartContainerRef}
            className={cn(
              'h-[170px] sm:h-[190px] md:h-[210px] rounded-lg overflow-hidden',
              !isChartReady && 'bg-muted/30',
            )}
          />
        )}

        {/* Time range selector */}
        <div className="flex items-center gap-1 mt-3">
          {TIME_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'px-2.5 sm:px-3 py-1.5 sm:py-1 rounded-md text-xs font-medium transition-colors min-w-[36px]',
                range === r
                  ? 'bg-[var(--2140-bitcoin)] text-black'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border',
              )}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Outcome pills */}
        {outcomeData.length > 1 && (
          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-3">
            {outcomeData.map((outcome) => {
              const isActive = !selectedOutcome || selectedOutcome === outcome.outcomeId;
              return (
                <button
                  key={outcome.outcomeId}
                  onClick={() =>
                    setSelectedOutcome((prev) =>
                      prev === outcome.outcomeId ? null : outcome.outcomeId,
                    )
                  }
                  className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl text-[11px] sm:text-xs font-bold transition-all"
                  style={{
                    backgroundColor: isActive ? hexToRgba(outcome.color, 0.12) : 'hsl(var(--muted) / 0.3)',
                    color: isActive ? outcome.color : 'hsl(var(--muted-foreground))',
                    border: `1.5px solid ${isActive ? hexToRgba(outcome.color, 0.35) : 'transparent'}`,
                  }}
                >
                  <span
                    className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: isActive ? outcome.color : 'hsl(var(--muted-foreground))' }}
                  />
                  <span className="truncate max-w-[70px] sm:max-w-[90px] md:max-w-[120px]">
                    {outcome.label}
                  </span>
                  <span className="ml-0.5">
                    {Number.isFinite(outcome.currentPrice) ? Math.round(outcome.currentPrice) : '—'}%
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default BaoMarketChart;
