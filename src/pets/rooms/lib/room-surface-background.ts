/**
 * Room Surface Background — shared CSS background generator.
 *
 * Used by PetsRoomShell (actual room), RoomPreviewCard, and PatternSwatch
 * to ensure consistent rendering between preview and live room.
 *
 * Security: only operates on validated hex colors and numeric angle/variant.
 * No raw CSS strings accepted from outside.
 */

import type { RoomSurfaceLayout } from './room-layout-schema';

/** Circular angle distance that wraps correctly around 0°/360° */
function angleDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/**
 * Generate a CSS background string for a given surface layout.
 *
 * @param surface - Validated surface layout (style, palette, variant, angle)
 * @param scale - Optional scale multiplier for pattern sizing (default 1).
 *               Use < 1 for smaller previews (e.g. 0.6 for swatch).
 */
export function getSurfaceBackground(surface: RoomSurfaceLayout, scale = 1): string {
  const [c1, c2] = surface.palette;
  if (!c1) return '#ccc';
  const angle = surface.angle ?? 0;

  switch (surface.style) {
    case 'solid':
      return c1;

    case 'gradient':
      return c2
        ? `linear-gradient(${angle || 180}deg, ${c1} 0%, ${c2} 100%)`
        : c1;

    case 'stripes': {
      // variant controls plank width; soft/medium/bold control contrast
      const baseSize = surface.variant === 'narrow' ? 8 : surface.variant === 'wide' ? 24 : 14;
      const size = Math.round(baseSize * scale);
      // soft/bold affect the accent stripe opacity
      const accentAlpha = surface.variant === 'soft' ? '90' : surface.variant === 'bold' ? '' : 'cc';
      const accent = c2 ? `${c2}${accentAlpha}` : c1;
      return `repeating-linear-gradient(${angle || 180}deg, ${c1} 0px, ${c1} ${size}px, ${accent} ${size}px, ${accent} ${size * 2}px)`;
    }

    case 'dots': {
      // Angle offsets the dot grid using background-position shift
      const dotSize = Math.round(20 * scale);
      const radius = Math.max(1.5, 3 * scale);
      // Compute a diagonal offset from angle to shift the grid pattern
      const rad = (angle * Math.PI) / 180;
      const offsetX = Math.round(Math.cos(rad) * dotSize * 0.4);
      const offsetY = Math.round(Math.sin(rad) * dotSize * 0.4);
      return c2
        ? `radial-gradient(circle ${radius}px at ${dotSize / 2}px ${dotSize / 2}px, ${c2} ${radius * 0.7}px, transparent ${radius}px) ${offsetX}px ${offsetY}px / ${dotSize}px ${dotSize}px, ${c1}`
        : c1;
    }

    case 'wood': {
      // narrow/wide control plank width; soft/medium/bold control grain contrast
      const baseWidth = surface.variant === 'narrow' ? 8 : surface.variant === 'wide' ? 22 : 14;
      const grainWidth = surface.variant === 'bold' ? 4 : surface.variant === 'soft' ? 1 : 2;
      const plankSize = Math.round(baseWidth * scale);
      const grain = Math.max(1, Math.round(grainWidth * scale));
      return c2
        ? `repeating-linear-gradient(${angle || 90}deg, ${c1} 0px, ${c1} ${plankSize}px, ${c2} ${plankSize}px, ${c2} ${plankSize + grain}px)`
        : c1;
    }

    case 'tile': {
      // Ceramic tile: visible grout lines forming a grid.
      // Square grid for 0°/90°/180°/270°; diamond grid for 45°/135°/225°/315°.
      const tileSize = Math.round(28 * scale);
      const grout = Math.max(1, Math.round(2 * scale));
      const groutColor = c2 ? `${c2}60` : '#00000020';

      // Determine if angle is diagonal (within 10° of 45/135/225/315)
      const normAngle = ((angle % 360) + 360) % 360;
      const isDiagonal = [45, 135, 225, 315].some(d => angleDistance(normAngle, d) <= 10);

      if (isDiagonal) {
        // Diamond tile: two diagonal lines at 45° and 135° with adjusted tile size
        // so the diagonal repeat forms clear diamond shapes
        const diagSize = Math.round(tileSize * 0.707); // sqrt(2)/2 for diagonal spacing
        return [
          `repeating-linear-gradient(45deg, ${groutColor} 0px, ${groutColor} ${grout}px, transparent ${grout}px, transparent ${diagSize}px)`,
          `repeating-linear-gradient(-45deg, ${groutColor} 0px, ${groutColor} ${grout}px, transparent ${grout}px, transparent ${diagSize}px)`,
          c1,
        ].join(', ');
      }

      // Square tile grid: horizontal + vertical grout lines
      return [
        `repeating-linear-gradient(0deg, ${groutColor} 0px, ${groutColor} ${grout}px, transparent ${grout}px, transparent ${tileSize}px)`,
        `repeating-linear-gradient(90deg, ${groutColor} 0px, ${groutColor} ${grout}px, transparent ${grout}px, transparent ${tileSize}px)`,
        c1,
      ].join(', ');
    }

    case 'carpet':
      return c2
        ? `linear-gradient(${angle || 135}deg, ${c1} 0%, ${c2} 100%)`
        : c1;

    case 'circuit': {
      // PCB-style trace grid with glowing nodes
      const baseSize = Math.round(28 * scale);
      const trace = Math.max(1, Math.round(2 * scale));
      const traceColor = c2 ? `${c2}40` : `${c1}60`;
      const nodeColor = c2 ?? c1;
      return [
        c1,
        `repeating-linear-gradient(0deg, ${traceColor} 0px, ${traceColor} ${trace}px, transparent ${trace}px, transparent ${baseSize}px)`,
        `repeating-linear-gradient(90deg, ${traceColor} 0px, ${traceColor} ${trace}px, transparent ${trace}px, transparent ${baseSize}px)`,
        `radial-gradient(circle ${Math.max(2, 3 * scale)}px at ${baseSize / 2}px ${baseSize / 2}px, ${nodeColor} 0px, transparent ${Math.max(3, 5 * scale)}px)`,
        `radial-gradient(circle ${Math.max(2, 3 * scale)}px at 0px 0px, ${nodeColor} 0px, transparent ${Math.max(3, 5 * scale)}px)`,
      ].join(', ');
    }

    case 'hexgrid': {
      // Honeycomb/hex mesh pattern
      const hexSize = Math.round(24 * scale);
      const hexLine = Math.max(1, Math.round(1.5 * scale));
      const hexColor = c2 ? `${c2}50` : `${c1}70`;
      return [
        c1,
        `repeating-linear-gradient(90deg, ${hexColor} 0px, ${hexColor} ${hexLine}px, transparent ${hexLine}px, transparent ${hexSize}px)`,
        `repeating-linear-gradient(30deg, ${hexColor} 0px, ${hexColor} ${hexLine}px, transparent ${hexLine}px, transparent ${hexSize}px)`,
        `repeating-linear-gradient(-30deg, ${hexColor} 0px, ${hexColor} ${hexLine}px, transparent ${hexLine}px, transparent ${hexSize}px)`,
      ].join(', ');
    }

    case 'scanlines': {
      // CRT-style horizontal scanlines
      const lineSize = Math.round(4 * scale);
      const gapSize = Math.round(8 * scale);
      const lineColor = c2 ? `${c2}30` : `${c1}40`;
      return `repeating-linear-gradient(0deg, ${c1} 0px, ${c1} ${lineSize}px, ${lineColor} ${lineSize}px, ${lineColor} ${lineSize + gapSize}px)`;
    }

    case 'metal': {
      // Brushed metal floor with horizontal grain
      const grainSize = Math.round(3 * scale);
      const grainColor = c2 ? `${c2}35` : `${c1}50`;
      return [
        `linear-gradient(${angle || 180}deg, ${c1} 0%, ${c2 ?? c1} 100%)`,
        `repeating-linear-gradient(${angle || 0}deg, transparent 0px, transparent ${grainSize}px, ${grainColor} ${grainSize}px, ${grainColor} ${grainSize * 2}px)`,
      ].join(', ');
    }

    case 'glass': {
      // Reflective glass tiles with grid lines
      const tile = Math.round(32 * scale);
      const grout = Math.max(1, Math.round(2 * scale));
      const groutColor = c2 ? `${c2}50` : '#ffffff20';
      return [
        `linear-gradient(${angle || 180}deg, ${c1} 0%, ${c2 ?? c1} 100%)`,
        `repeating-linear-gradient(0deg, ${groutColor} 0px, ${groutColor} ${grout}px, transparent ${grout}px, transparent ${tile}px)`,
        `repeating-linear-gradient(90deg, ${groutColor} 0px, ${groutColor} ${grout}px, transparent ${grout}px, transparent ${tile}px)`,
      ].join(', ');
    }

    case 'holo': {
      // Holographic shimmer grid
      const grid = Math.round(20 * scale);
      const line = Math.max(1, Math.round(1 * scale));
      const lineColor = c2 ? `${c2}40` : `${c1}60`;
      return [
        `linear-gradient(${angle || 135}deg, ${c1} 0%, ${c2 ?? c1} 100%)`,
        `repeating-linear-gradient(0deg, ${lineColor} 0px, ${lineColor} ${line}px, transparent ${line}px, transparent ${grid}px)`,
        `repeating-linear-gradient(90deg, ${lineColor} 0px, ${lineColor} ${line}px, transparent ${line}px, transparent ${grid}px)`,
      ].join(', ');
    }

    default:
      return c1;
  }
}
