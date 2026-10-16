/**
 * Canvas waveform diagram (SoundCloud-style).
 *
 * Draws the peaks as centred bars on a neutral canvas, then a second canvas
 * with the same bars in the primary color clipped to the played fraction — so
 * progress updates are pure CSS with no redraw. Any children are rendered in
 * an absolutely positioned overlay (used for the timed-comment avatars).
 */

import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface WaveformProps {
  /** Normalised peaks (0..1). When undefined a flat baseline is drawn. */
  peaks: number[] | undefined;
  /** Played fraction, 0..1. */
  progress: number;
  /** Called with the clicked fraction (0..1) when the diagram is clicked. */
  onSeek?: (ratio: number) => void;
  className?: string;
  /** Overlay content (e.g. timed-comment markers), positioned over the bars. */
  children?: React.ReactNode;
  /** Accessible label. */
  ariaLabel?: string;
}

function drawBars(canvas: HTMLCanvasElement, peaks: number[] | undefined, color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (W === 0 || H === 0) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = color;

  if (!peaks || peaks.length === 0) {
    // Flat baseline so the diagram still reads as a surface.
    ctx.globalAlpha = 0.6;
    ctx.fillRect(0, H / 2 - 1, W, 2);
    ctx.globalAlpha = 1;
    return;
  }

  const barW = W / peaks.length;
  const gap = Math.min(1.5, barW * 0.35);
  const drawW = Math.max(1, barW - gap);
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(2, peaks[i] * H * 0.92);
    const x = i * barW + (barW - drawW) / 2;
    ctx.fillRect(x, (H - h) / 2, drawW, h);
  }
}

export function Waveform({ peaks, progress, onSeek, className, children, ariaLabel }: WaveformProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const base = baseRef.current;
    const fg = fgRef.current;
    if (!base || !fg) return;
    const cs = getComputedStyle(base);
    const primary = cs.getPropertyValue('--primary').trim();
    const muted = cs.getPropertyValue('--muted-foreground').trim();
    drawBars(base, peaks, muted ? `hsl(${muted} / 0.30)` : 'rgba(128,128,128,0.3)');
    drawBars(fg, peaks, primary ? `hsl(${primary})` : 'currentColor');
  }, [peaks]);

  useEffect(() => {
    draw();
    const el = baseRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio);
  }, [onSeek]);

  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <div
      className={cn('relative select-none', onSeek && 'cursor-pointer', className)}
      onClick={onSeek ? handleClick : undefined}
      role={onSeek ? 'slider' : undefined}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      tabIndex={onSeek ? 0 : undefined}
    >
      <canvas ref={baseRef} className="absolute inset-0 w-full h-full" />
      <canvas
        ref={fgRef}
        className="absolute inset-0 w-full h-full"
        style={{ clipPath: `inset(0 ${(1 - clamped) * 100}% 0 0)` }}
      />
      {children}
    </div>
  );
}
