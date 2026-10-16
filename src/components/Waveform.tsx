/**
 * Canvas waveform diagram (SoundCloud-style).
 *
 * Draws the peaks as centred bars on a neutral canvas, then a second canvas
 * with the same bars in the primary color clipped to the played fraction — so
 * progress updates are pure CSS with no redraw. Any children are rendered in
 * an absolutely positioned overlay (used for the timed-comment avatars).
 *
 * With `tilt`, the diagram gains a lightweight CSS-3D interaction: it parallax-
 * tilts toward the pointer and can be dragged to rotate (360°), all in CSS —
 * no 3D engine, and a drag is distinguished from a seek click.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Enable the CSS-3D tilt/drag interaction. */
  tilt?: boolean;
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

const DRAG_THRESHOLD = 8;
const MAX_TILT = 16;

export function Waveform({ peaks, progress, onSeek, className, children, ariaLabel, tilt = false }: WaveformProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);

  const [rot, setRot] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; rx: number; ry: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

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
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio);
  }, [onSeek]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!tilt || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, rx: rot.x, ry: rot.y, moved: false };
    setDragging(true);
  }, [tilt, rot.x, rot.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!tilt) return;
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      suppressClick.current = true;
      setRot({
        x: Math.max(-MAX_TILT, Math.min(MAX_TILT, d.rx - dy * 0.35)),
        y: d.ry + dx * 0.6, // free spin → 360°
      });
      return;
    }
    // Hover parallax.
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    setRot({ x: -ny * MAX_TILT, y: nx * MAX_TILT });
  }, [tilt]);

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!tilt) return;
    if (drag.current) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    drag.current = null;
    setDragging(false);
    setRot({ x: 0, y: 0 });
  }, [tilt]);

  const clamped = Math.max(0, Math.min(1, progress));
  const tiltStyle: React.CSSProperties | undefined = tilt
    ? {
        transform: `perspective(900px) rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
        transformStyle: 'preserve-3d',
        transition: dragging ? 'none' : 'transform 220ms ease-out',
        willChange: 'transform',
      }
    : undefined;

  return (
    <div
      className={cn('relative select-none', onSeek && 'cursor-pointer', tilt && '[perspective:900px]', className)}
      onClick={onSeek ? handleClick : undefined}
      onPointerDown={tilt ? onPointerDown : undefined}
      onPointerMove={tilt ? onPointerMove : undefined}
      onPointerUp={tilt ? endDrag : undefined}
      onPointerCancel={tilt ? endDrag : undefined}
      onPointerLeave={tilt ? endDrag : undefined}
      role={onSeek ? 'slider' : undefined}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      tabIndex={onSeek ? 0 : undefined}
    >
      <div className="absolute inset-0" style={tiltStyle}>
        <canvas ref={baseRef} className="absolute inset-0 w-full h-full" />
        <canvas
          ref={fgRef}
          className="absolute inset-0 w-full h-full"
          style={{ clipPath: `inset(0 ${(1 - clamped) * 100}% 0 0)` }}
        />
        {children}
      </div>
    </div>
  );
}
