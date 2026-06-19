/**
 * EmojiFrame
 *
 * A reusable emoji border band used by LoveListContent and any other
 * component that wants a scattered-emoji frame. Originally lived inside
 * StationeryBackground (letter-specific); moved here so non-letter features
 * can keep using it.
 */

import { useMemo } from 'react';
import { darkenHex } from '@/lib/colorUtils';

export type PaletteLayout =
  | 'horizontal'
  | 'vertical'
  | 'grid'
  | 'star'
  | 'checkerboard'
  | 'diagonalStripes';

interface EmojiFrameProps {
  tint: string | null;
  thickness: number;
  emojis: string[];
  defaultBg: string;
  /**
   * Jitter positions, rotations, and sizes for a hand-scattered look
   * (deterministic, so the frame renders identically every time).
   */
  scatter?: boolean;
  /**
   * Keep `defaultBg` for the band even when a tint is applied — the tint then
   * only recolors the emojis (via the blend overlay) instead of also
   * darkening the band background.
   */
  keepDefaultBg?: boolean;
}

/** Deterministic pseudo-random in [0, 1) from an index + salt. */
function jitter(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Emoji border band.
 * Positions itself at `inset: -thickness` of its nearest positioned ancestor
 * with `zIndex: -1` — render it inside a `relative isolate` wrapper that has
 * `thickness` of surrounding padding to expose the band.
 */
export function EmojiFrame({ tint, thickness, emojis, defaultBg, scatter, keepDefaultBg }: EmojiFrameProps) {
  const t = thickness;
  const bgColor = tint && !keepDefaultBg ? darkenHex(tint, 0.45) : defaultBg;

  const flowers = useMemo(() => {
    const gap = scatter ? 40 : 48;
    const row1 = 8;
    const row2 = t - 4;

    const items: { emoji: string; left: string; top: string; size: number; rot: number; jx: number; jy: number }[] = [];
    let ei = 0;
    const next = () => emojis[ei++ % emojis.length];

    const place = (left: string, top: string) => {
      const i = items.length;
      items.push(scatter
        ? {
          emoji: next(),
          left,
          top,
          size: 26 + jitter(i, 1) * 18,
          rot: (jitter(i, 2) - 0.5) * 60,
          jx: (jitter(i, 3) - 0.5) * 14,
          jy: (jitter(i, 4) - 0.5) * 14,
        }
        : { emoji: next(), left, top, size: 40, rot: 0, jx: 0, jy: 0 });
    };

    for (const d of [row1, row2]) {
      for (let x = 8; x < 800; x += gap) place(`${x}px`, `${d}px`);
      for (let x = 8; x < 800; x += gap) place(`${x}px`, `calc(100% - ${d}px)`);
    }
    for (const d of [row1, row2]) {
      for (let y = t + gap; y < 800; y += gap) place(`${d}px`, `${y}px`);
      for (let y = t + gap; y < 800; y += gap) place(`calc(100% - ${d}px)`, `${y}px`);
    }

    return items;
  }, [emojis, t, scatter]);

  return (
    <div
      className="absolute pointer-events-none select-none overflow-hidden"
      aria-hidden
      style={{
        inset: -t,
        borderRadius: '2rem',
        zIndex: -1,
        backgroundColor: bgColor,
      }}
    >
      {flowers.map((f, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: f.left,
            top: f.top,
            fontSize: `${f.size}px`,
            transform: `translate(${f.jx}px, ${f.jy}px) rotate(${f.rot}deg) translate(-50%, -50%)`,
            lineHeight: 1,
          }}
        >
          {f.emoji}
        </span>
      ))}
      {tint && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: tint,
            mixBlendMode: 'color',
            opacity: 0.6,
          }}
        />
      )}
    </div>
  );
}
