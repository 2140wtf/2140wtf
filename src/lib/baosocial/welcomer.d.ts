/**
 * Welcomer — re-export layer.
 *
 * The protocol logic has been deepened into two focused modules:
 *   - welcomer-core.ts:  base protocol (PoW, challenges, wraps, re-key)
 *   - welcomer-gate.ts:  P3 admission menu evaluation (imports admission.ts)
 *
 * This module re-exports everything so existing consumers continue to
 * work without changes. New code should import directly from the
 * appropriate submodule.
 */
export * from './welcomer-core.js';
export * from './welcomer-gate.js';
