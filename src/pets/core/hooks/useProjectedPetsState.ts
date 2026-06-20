/**
 * Hook for projecting Pets decay state in the UI.
 * 
 * This hook provides a local projection of decay without publishing events.
 * It recalculates every 60 seconds while the component is mounted.
 * 
 * When social interactions are provided, their effects are layered on top
 * of the decayed stats. This is read-only projection — no 31124 mutation.
 * 
 * The projected state is for UI display only. Actual mutations must
 * recalculate from the persisted state before publishing.
 * 
 * @see docs/pets/decay-system.md
 */

import { useState, useEffect, useMemo } from 'react';

import type { PetsCompanion, PetsStats } from '../lib/pets';
import { applyPetsDecayForCompanion, getVisibleStatsWithValues, type DecayResult } from '@/pets/core/lib/pets-decay';
import { applySocialInteractions } from '@/pets/core/lib/pets-social-projection';
import { resolveSocialCheckpoint, type PetsInteraction } from '@/pets/core/lib/pets-interaction';

/** UI refresh interval in milliseconds (60 seconds) */
const UI_REFRESH_INTERVAL_MS = 60_000;

/**
 * Projected Pets state for UI display.
 */
export interface ProjectedPetsState {
  /** Stats after applying projected decay */
  stats: PetsStats;
  /** Visible stats for the current stage with status indicators */
  visibleStats: Array<{
    stat: keyof PetsStats;
    value: number;
    status: 'critical' | 'warning' | 'normal';
  }>;
  /** Time elapsed since last decay (seconds) */
  elapsedSeconds: number;
  /** Timestamp of the projection calculation */
  projectedAt: number;
  /** Whether this is a fresh projection (recalculated this render) */
  isFresh: boolean;
}

/**
 * Hook to get a projected Pets state with decay and social interactions applied.
 * 
 * Features:
 * - Immediately calculates projected state on mount/companion change
 * - Recalculates every 60 seconds while mounted
 * - Applies social interaction effects on top of decay when provided
 * - Pure calculation - does not publish any events
 * - Returns both full stats and stage-appropriate visible stats
 * 
 * @param companion    - The persisted Pets companion (source of truth)
 * @param interactions - Optional sorted kind 1124 interactions to project on top of decay
 * @returns Projected state with decay (and social effects) applied, or null if no companion
 */
export function useProjectedPetsState(
  companion: PetsCompanion | null,
  interactions?: readonly PetsInteraction[],
): ProjectedPetsState | null {
  // Track when we last recalculated
  const [refreshTick, setRefreshTick] = useState(0);
  
  // Set up 60-second refresh interval
  useEffect(() => {
    if (!companion) return;
    
    const interval = setInterval(() => {
      setRefreshTick(t => t + 1);
    }, UI_REFRESH_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, [companion]);
  
  // Calculate projected state
  const projectedState = useMemo((): ProjectedPetsState | null => {
    if (!companion) return null;
    
    const now = Math.floor(Date.now() / 1000);
    
    // Step 1: Apply decay from persisted state (with category/rarity modifiers)
    const decayResult: DecayResult = applyPetsDecayForCompanion(companion, now);
    
    // Step 2: Apply social interaction effects on top of decayed stats.
    // Uses the canonical `resolveSocialCheckpoint()` so the projection layer
    // shares the exact same checkpoint interpretation as the query layer.
    // When valid, the checkpoint's last_event_id is used for boundary dedup.
    // When invalid/absent (V1 fallback), no interactions are pre-excluded.
    const resolved = resolveSocialCheckpoint(companion);
    const finalStats = (interactions && interactions.length > 0)
      ? applySocialInteractions(
          decayResult.stats,
          interactions,
          resolved.checkpoint,
        )
      : decayResult.stats;

    // Get visible stats for the stage
    const visibleStats = getVisibleStatsWithValues(companion.stage, finalStats);
    
    return {
      stats: finalStats,
      visibleStats,
      elapsedSeconds: decayResult.elapsedSeconds,
      projectedAt: now,
      isFresh: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshTick triggers recalculation
  }, [companion, interactions, refreshTick]);
  
  return projectedState;
}

/**
 * Calculate projected decay for a companion at a specific timestamp,
 * optionally layering social interaction effects on top.
 * 
 * This is a utility function for use outside of React components,
 * such as in feed card rendering (PetsStateCard).
 * 
 * @param companion    - The persisted Pets companion
 * @param now          - Unix timestamp to calculate decay to (defaults to current time)
 * @param interactions - Optional sorted kind 1124 interactions to project
 * @returns Decay result with socially-adjusted stats
 */
export function calculateProjectedDecay(
  companion: PetsCompanion,
  now?: number,
  interactions?: readonly PetsInteraction[],
): DecayResult {
  const result = applyPetsDecayForCompanion(companion, now);

  if (interactions && interactions.length > 0) {
    // Canonical checkpoint resolution — same path as the hook and query layer.
    const resolved = resolveSocialCheckpoint(companion);
    return {
      ...result,
      stats: applySocialInteractions(
        result.stats,
        interactions,
        resolved.checkpoint,
      ),
    };
  }

  return result;
}
