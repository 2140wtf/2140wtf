import { useNostr } from '@nostrify/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';

import { APP_SEARCH_RELAYS } from '@/lib/appRelays';
import { parseMusicTrack } from '@/lib/musicHelpers';

const PAGE_SIZE = 20;

/** Filter shape shared by both track queries below. */
type TrackFilter = NostrFilter & { authors: string[]; limit: number; until?: number };

/**
 * Fetch an author's tracks from the app pool and the NIP-50 search relays,
 * merged and deduplicated by event id.
 *
 * The pool alone is not enough for a tab that has to decide *whether to exist*
 * on first paint: `NPool` resolves a query once the first relay reports EOSE
 * (eoseTimeout 300ms), so a query issued before the read relays have connected
 * returns an empty array and never retries. `nostr.group(...)` opens its own
 * connections for the query, so the search relays still answer in that window.
 * Either source failing is tolerated — only a total failure is an error.
 */
async function queryAuthorTracks(
  nostr: NPool,
  filter: TrackFilter,
  signal: AbortSignal,
): Promise<NostrEvent[]> {
  const [pooled, searched] = await Promise.allSettled([
    nostr.query([filter], { signal }),
    nostr.group(APP_SEARCH_RELAYS).query([filter], { signal }),
  ]);

  if (pooled.status === 'rejected' && searched.status === 'rejected') {
    throw pooled.reason instanceof Error ? pooled.reason : new Error('Track query failed');
  }

  const byId = new Map<string, NostrEvent>();
  for (const result of [pooled, searched]) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value) byId.set(event.id, event);
  }
  return [...byId.values()];
}

/** Page of an author's tracks, with the cursor for the next page. */
interface ProfileTracksPage {
  /** Valid tracks (audio URL present), newest first. */
  events: NostrEvent[];
  /** Oldest timestamp in this page, used as the pagination cursor. */
  oldestTimestamp: number | undefined;
  /** Raw event count, used to detect page exhaustion. */
  count: number;
}

/**
 * Whether an author has published any playable track (kind 36787).
 *
 * The profile page uses this to decide whether to offer a Music tab at all:
 * a profile with no music shows no empty tab. Same validity rule as the rest
 * of the music UI — an event without an audio URL is not a track.
 */
export function useProfileHasMusic(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<boolean>({
    queryKey: ['profile-has-music', pubkey ?? ''],
    queryFn: async ({ signal }) => {
      const events = await queryAuthorTracks(
        nostr,
        { kinds: [36787], authors: [pubkey!], limit: PAGE_SIZE },
        AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      );
      return events.some((event) => parseMusicTrack(event) !== null);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/**
 * Infinite list of an author's music tracks for the profile Music tab.
 *
 * Paginates with an `until` cursor on `created_at` and drops events that do
 * not parse as tracks, so a relay holding junk kind-36787 events cannot push
 * real tracks off the page.
 */
export function useProfileTracks(pubkey: string | undefined, enabled = true) {
  const { nostr } = useNostr();

  return useInfiniteQuery<ProfileTracksPage, Error>({
    queryKey: ['profile-tracks', pubkey ?? ''],
    queryFn: async ({ pageParam, signal }) => {
      if (!pubkey) return { events: [], oldestTimestamp: undefined, count: 0 };

      const filter: TrackFilter = { kinds: [36787], authors: [pubkey], limit: PAGE_SIZE };
      if (typeof pageParam === 'number') {
        filter.until = pageParam;
      }

      const events = await queryAuthorTracks(
        nostr,
        filter,
        AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      );

      const now = Math.floor(Date.now() / 1000);
      const recent = events
        .filter((event) => event.created_at <= now)
        .sort((a, b) => b.created_at - a.created_at);

      return {
        events: recent.filter((event) => parseMusicTrack(event) !== null),
        oldestTimestamp: recent.length > 0 ? recent[recent.length - 1].created_at : undefined,
        count: recent.length,
      };
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.count < PAGE_SIZE || lastPage.oldestTimestamp === undefined) {
        return undefined;
      }
      return lastPage.oldestTimestamp - 1;
    },
    initialPageParam: undefined as number | undefined,
    enabled: !!pubkey && enabled,
    staleTime: 30 * 1000,
  });
}
