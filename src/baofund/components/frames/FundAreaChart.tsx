import React, { useEffect, useRef } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type Time, AreaSeries } from 'lightweight-charts';

export interface FundAreaChartProps {
  /** Cumulative contributions per day (sats). Last = total pledged. */
  cumulative: number[];
  height?: number;
}

export const FundAreaChart = React.memo(function FundAreaChart({
  cumulative,
  height = 56,
}: FundAreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Canvas (lightweight-charts) cannot parse CSS var() - resolve to real colors.
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--np-accent').trim() || '#b3442c';
    const muted = css.getPropertyValue('--np-muted').trim() || '#6b6259';
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: muted,
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: accent,
      topColor: accent,
      bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const data = cumulative.map((value, i) => ({
      time: (Date.now() / 1000 - (cumulative.length - 1 - i) * 86400) as Time,
      value,
    }));
    series.setData(data);
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

    const resize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth, height });
      }
    };
    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [cumulative, height]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
});
