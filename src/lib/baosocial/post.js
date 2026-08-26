/**
 * Post helpers — shared constants for the reliable post loop.
 *
 * This module intentionally has no imports beyond builtins. It exists so
 * the DEFAULT_FLUSH_MS constant can be shared between session.ts and demo
 * without pulling in node:fs from provision.ts (the original cause of the
 * client.ts duplication that was flagged as a final-boss regression).
 */
/** Default flush deadline (ms) — the window a scribe waits before rolling
 *  a new scroll segment. Receipt timeout is 3× this value (§3). */
export const DEFAULT_FLUSH_MS = 4000;
