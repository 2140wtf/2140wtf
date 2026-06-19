/**
 * Room Layout Defaults — canonical static room layouts.
 *
 * These are the theme-independent, deterministic defaults used for:
 * - New/unconfigured accounts (no saved room layout)
 * - The editor's "Reset" action
 *
 * Each room has a designed visual identity that works well regardless
 * of the active app theme. Theme-aware defaults (which read CSS custom
 * properties at runtime) live in room-theme-defaults.ts and are only
 * applied when the user explicitly clicks "Use theme" in the editor.
 *
 * Extracted to its own file to avoid circular imports between
 * room-layout-schema.ts and room-theme-defaults.ts.
 */

import type { PetsRoomId } from './room-config';
import type { RoomLayout } from './room-layout-schema';

export const DEFAULT_ROOM_LAYOUTS: Record<PetsRoomId, RoomLayout> = {
  home: {
    // Cozy living room: warm amber gradient wall, oak wide wood floor
    wall: { style: 'gradient', palette: ['#fef9ef', '#fef3c7'] },
    floor: { style: 'wood', palette: ['#b45309', '#78350f'], variant: 'wide' },
  },
  kitchen: {
    // Bright kitchen: clean cream wall, light marble tile floor
    wall: { style: 'solid', palette: ['#fafaf9', '#f5f5f4'] },
    floor: { style: 'tile', palette: ['#f5f5f4', '#d6d3d1'] },
  },
  care: {
    // Bathroom: pale blue wall, diamond ceramic tile floor
    wall: { style: 'solid', palette: ['#f0f9ff', '#e0f2fe'] },
    floor: { style: 'tile', palette: ['#f0f9ff', '#bae6fd'], angle: 45 },
  },
  rest: {
    // Sleep room: soft lavender gradient wall, gentle purple carpet
    wall: { style: 'gradient', palette: ['#faf5ff', '#ede9fe'] },
    floor: { style: 'carpet', palette: ['#a78bfa', '#8b5cf6'], variant: 'soft' },
  },
  closet: {
    // Wardrobe: warm taupe wall, dark walnut narrow wood floor
    wall: { style: 'solid', palette: ['#faf5f0', '#f0e8df'] },
    floor: { style: 'wood', palette: ['#78350f', '#451a03'], variant: 'narrow' },
  },
};

/**
 * Cypherpunk 2140 themed room defaults.
 *
 * Used when the pet surface is rendered with the `.pets-cyber` theme.
 * These layouts use the cyber surface styles (circuit, hexgrid, scanlines,
 * metal, glass, holo) and the OKLch neon palette from the design system.
 */
export const CYBER_ROOM_LAYOUTS: Record<PetsRoomId, RoomLayout> = {
  home: {
    // Hacker apartment: scanline wall, circuit floor
    wall: { style: 'scanlines', palette: ['#1a1a2e', '#22d3ee'] },
    floor: { style: 'circuit', palette: ['#0f172a', '#06b6d4'], variant: 'medium' },
  },
  kitchen: {
    // Nutrient synth: hexgrid wall, metal floor
    wall: { style: 'hexgrid', palette: ['#1e1b4b', '#c026d3'] },
    floor: { style: 'metal', palette: ['#171717', '#525252'], variant: 'bold' },
  },
  care: {
    // Med-bay: circuit wall, glass floor
    wall: { style: 'circuit', palette: ['#0f172a', '#22c55e'] },
    floor: { style: 'glass', palette: ['#064e3b', '#34d399'], variant: 'medium' },
  },
  rest: {
    // Sleep pod: gradient wall, holo floor
    wall: { style: 'gradient', palette: ['#1e1b4b', '#312e81'] },
    floor: { style: 'holo', palette: ['#4c1d95', '#a78bfa'], variant: 'soft' },
  },
  closet: {
    // Gear storage: solid dark wall, hexgrid floor
    wall: { style: 'solid', palette: ['#111827', '#374151'] },
    floor: { style: 'hexgrid', palette: ['#0f172a', '#f59e0b'], variant: 'narrow' },
  },
};
