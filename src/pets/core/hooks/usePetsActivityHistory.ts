/**
 * Hook for fetching recent Pets interaction history (kind 1124).
 *
 * Shows the last 24 hours of social care interactions regardless of
 * consolidation state. This gives the owner a true "recent help" view
 * of who has helped their Pets.
 *
 * Independent of the social checkpoint — already-consolidated interactions
 * still appear in history because they represent real past help.
 *
 * Read-only: never mutates canonical state.
 */

import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import type { PetsCompanion } from '../lib/pets';
import {
  KIND_PETS_INTERACTION,
  parseInteractionEvent,
  type PetsInteraction,
} from '../lib/pets-interaction';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of history events to display. */
const HISTORY_LIMIT = 20;

/**
 * Recency window for the activity history view (24 hours).
 * Only interactions from the last 24 hours are shown.
 */
const MAX_HISTORY_WINDOW_SECONDS = 24 * 60 * 60;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UsePetsActivityHistoryResult {
  /** Parsed interactions sorted newest-first (descending created_at). */
  interactions: PetsInteraction[];
  /** True only while the initial load is in progress with no cached data. */
  isLoading: boolean;
}

/**
 * Fetch recent interaction history for a Pets (last 24 hours, max 20).
 *
 * @param companion - The current Pets companion, or null to disable.
 */
export function usePetsActivityHistory(
  companion: PetsCompanion | null,
): UsePetsActivityHistoryResult {
  const { nostr } = useNostr();

  const coordinate = useMemo(() => {
    if (!companion) return undefined;
    return `31124:${companion.event.pubkey}:${companion.d}`;
  }, [companion]);

  const query = useQuery({
    queryKey: ['pets-activity-history', coordinate],
    queryFn: async ({ signal }) => {
      if (!coordinate || !companion) return [];

      const now = Math.floor(Date.now() / 1000);
      const since = now - MAX_HISTORY_WINDOW_SECONDS;

      const events = await nostr.query(
        [{
          kinds: [KIND_PETS_INTERACTION],
          '#a': [coordinate],
          limit: HISTORY_LIMIT,
          since,
        }],
        { signal },
      );

      // Validate, parse, exclude owner interactions.
      const ownerPubkey = companion.event.pubkey;
      const parsed: PetsInteraction[] = [];
      for (const event of events) {
        if (event.pubkey === ownerPubkey) continue;
        const interaction = parseInteractionEvent(event);
        if (interaction) parsed.push(interaction);
      }

      // Sort descending (newest first) for display.
      parsed.sort((a, b) => b.createdAt - a.createdAt || b.event.id.localeCompare(a.event.id));

      return parsed.slice(0, HISTORY_LIMIT);
    },
    enabled: !!coordinate,
    staleTime: 2 * 60_000,      // 2 minutes
    gcTime: 5 * 60 * 1000,      // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  return {
    interactions: query.data ?? [],
    isLoading: query.isLoading,
  };
}
