import { useMemo } from 'react';

import { useCuratedMusicArtists } from '@/hooks/useCuratedMusicArtists';
import { useMusicData, type MusicArtist } from '@/hooks/useMusicData';

/**
 * The shared artist roster used by both `/music` and the home Music feed.
 * Curated artists stay first; artists discovered from valid track events are
 * appended by track count without duplicates.
 */
export function useMusicArtists(enabled = true) {
  const curatedQuery = useCuratedMusicArtists(enabled);
  const musicQuery = useMusicData({ enabled });

  const artists = useMemo((): MusicArtist[] => {
    const trackCountByPubkey = new Map(
      musicQuery.artists.map((artist) => [artist.pubkey, artist.trackCount]),
    );
    const seen = new Set<string>();
    const merged: MusicArtist[] = [];

    for (const pubkey of curatedQuery.data ?? []) {
      if (seen.has(pubkey)) continue;
      seen.add(pubkey);
      merged.push({ pubkey, trackCount: trackCountByPubkey.get(pubkey) ?? 0 });
    }

    for (const artist of musicQuery.artists) {
      if (seen.has(artist.pubkey)) continue;
      seen.add(artist.pubkey);
      merged.push(artist);
    }

    return merged;
  }, [curatedQuery.data, musicQuery.artists]);

  return {
    artists,
    isLoading: enabled && artists.length === 0 && (curatedQuery.isLoading || musicQuery.isLoading),
    isError: enabled && artists.length === 0 && curatedQuery.isError && musicQuery.isError,
  };
}
