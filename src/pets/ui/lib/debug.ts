/**
 * Centralized debug logging for Pets visual system.
 *
 * All Pets debug logging should go through this helper.
 * Only logs when BOTH conditions are met:
 *   1. Running in development mode (import.meta.env.DEV)
 *   2. PETS_DEBUG flag is enabled
 *
 * To enable: set PETS_DEBUG = true below.
 * To disable: set PETS_DEBUG = false (default for production-clean console).
 */

/** Master switch for Pets visual debug logging. */
const PETS_DEBUG = false;

type DebugCategory =
  | 'svg-rebuild'    // SVG pipeline rebuilds (customizedSvg / safeSvg)
  | 'dom-replace'    // SVG DOM node was replaced (animation killer)
  | 'dom-mount'      // SVG DOM node mounted for first time
  | 'prop-change'    // Props changed on a visual component
  | 'ref-change'     // Object reference changed (companion, pets, recipe)
  | 'render-freq'    // Render frequency tracking
  | 'smil'           // SMIL animation element counts
  | 'recipe'         // Recipe resolution and stability
  | 'general';       // Catch-all

/**
 * Log a Pets debug message.
 *
 * @param category - Debug category for filtering
 * @param args - Arguments forwarded to console.log
 */
export function debugPets(category: DebugCategory, ...args: unknown[]): void {
  if (!import.meta.env.DEV || !PETS_DEBUG) return;
  console.log(`[pets:${category}]`, ...args);
}

/**
 * Log a Pets debug warning (always styled as warning).
 */
export function debugPetsWarn(category: DebugCategory, ...args: unknown[]): void {
  if (!import.meta.env.DEV || !PETS_DEBUG) return;
  console.warn(`[pets:${category}]`, ...args);
}
