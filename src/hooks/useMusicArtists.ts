import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { useCuratedMusicArtists } from '@/hooks/useCuratedMusicArtists';
import { useMusicData, type MusicArtist } from '@/hooks/useMusicData';
import { APP_SEARCH_RELAYS } from '@/lib/appRelays';
import { parseMusicTrack } from '@/lib/musicHelpers';

/**
 * Artists requested from the search relay. `distinct:author` returns at most
 * one track per artist, so this is a roster size, not an event budget.
 */
const ROSTER_LIMIT = 500;

/**
 * Every artist with a track on the search relay, one track each.
 *
 * The roster used to be inferred from the newest 200 global tracks, which at
 * current release volume only spans ~5 weeks: an artist whose last track was
 * older than that window disappeared from the Artists tab while the relays
 * still held their whole catalogue. NIP-50 `distinct:author` answers the
 * question directly — one event per author — so an artist stays listed long
 * after their last release.
 */
function useRosterArtists(enabled: boolean) {
  const { nostr } = useNostr();

  return useQuery<string[]>({
    queryKey: ['music-roster-artists', ROSTER_LIMIT],
    queryFn: async ({ signal }) => {
      const events = await nostr.group(APP_SEARCH_RELAYS).query(
        [{ kinds: [36787], limit: ROSTER_LIMIT, search: 'distinct:author' }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) },
      );

      // Same validity gate as the rest of the music UI: a track without an
      // audio URL does not make its author an artist.
      return events.filter((ev) => parseMusicTrack(ev) !== null).map((ev) => ev.pubkey);
    },
    staleTime: 10 * 60 * 1000, // 10 min
    gcTime: 60 * 60 * 1000, // 1 hr
    enabled,
  });
}

/**
 * The shared artist roster used by both `/music` and the home Music feed.
 * Curated artists stay first; the relay roster and artists discovered from
 * recent tracks are appended without duplicates.
 */
export function useMusicArtists(enabled = true) {
  const curatedQuery = useCuratedMusicArtists(enabled);
  const rosterQuery = useRosterArtists(enabled);
  const musicQuery = useMusicData({ enabled });

  const artists = useMemo((): MusicArtist[] => {
    const trackCountByPubkey = new Map(
      musicQuery.artists.map((artist) => [artist.pubkey, artist.trackCount]),
    );
    const seen = new Set<string>();
    const merged: MusicArtist[] = [];

    const push = (pubkey: string) => {
      if (seen.has(pubkey)) return;
      seen.add(pubkey);
      merged.push({ pubkey, trackCount: trackCountByPubkey.get(pubkey) ?? 0 });
    };

    for (const pubkey of curatedQuery.data ?? []) push(pubkey);
    for (const pubkey of rosterQuery.data ?? []) push(pubkey);
    // Relays without NIP-50 still contribute anyone the roster query missed.
    for (const artist of musicQuery.artists) push(artist.pubkey);

    return merged;
  }, [curatedQuery.data, rosterQuery.data, musicQuery.artists]);

  return {
    artists,
    isLoading: enabled && artists.length === 0 && (curatedQuery.isLoading || musicQuery.isLoading),
    isError: enabled && artists.length === 0 && curatedQuery.isError && musicQuery.isError,
  };
}
