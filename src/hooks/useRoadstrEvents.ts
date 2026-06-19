import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  parseRoadstrConfirmation,
  parseRoadstrReport,
  type RoadstrConfirmation,
  type RoadstrReport,
} from '@/lib/roadstr';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export interface RoadstrEventsResult {
  reports: RoadstrReport[];
  confirmations: RoadstrConfirmation[];
  allEvents: NostrEvent[];
}

/**
 * Query active Roadstr reports and their confirmations for a set of geohash cells.
 *
 * The geohash set should already include the center cell plus its 8 neighbors
 * (see `getGeohashNeighbors`). Fetches events from the last 7 days and parses
 * both kind 1315 reports and kind 1316 confirmations.
 */
export function useRoadstrEvents(geohashes: string[] | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['roadstr-events', geohashes],
    queryFn: async ({ signal }): Promise<RoadstrEventsResult> => {
      if (!geohashes || geohashes.length === 0) {
        return { reports: [], confirmations: [], allEvents: [] };
      }

      const since = Math.floor(Date.now() / 1000) - SEVEN_DAYS_SECONDS;
      const events = await nostr.query(
        [{ kinds: [1315, 1316], '#g': geohashes, since }],
        { signal },
      );

      const reports: RoadstrReport[] = [];
      const confirmations: RoadstrConfirmation[] = [];

      for (const event of events) {
        if (event.kind === 1315) {
          const report = parseRoadstrReport(event);
          if (report) reports.push(report);
        } else if (event.kind === 1316) {
          const confirmation = parseRoadstrConfirmation(event);
          if (confirmation) confirmations.push(confirmation);
        }
      }

      return { reports, confirmations, allEvents: events };
    },
    enabled: !!geohashes && geohashes.length > 0,
    staleTime: 30_000,
  });
}
