import { useEffect, useMemo } from 'react';
import { Loader2, Music } from 'lucide-react';
import { useInView } from 'react-intersection-observer';
import type { NostrEvent } from '@nostrify/nostrify';

import { useProfileTracks } from '@/hooks/useProfileMusic';
import { useMuteList } from '@/hooks/useMuteList';
import { isEventMuted } from '@/lib/muteHelpers';
import { MusicTrackRow, MusicTrackRowSkeleton } from './MusicTrackRow';

interface ProfileMusicTabProps {
  /** Pubkey whose tracks are listed. */
  pubkey: string;
}

/**
 * The Music tab on a profile — every kind 36787 track the author published,
 * newest first, with the same row UI (play, waveform, timed comments) as the
 * Tracks tab on `/music`.
 *
 * Only rendered when `useProfileHasMusic` confirmed the author has at least
 * one playable track.
 */
export function ProfileMusicTab({ pubkey }: ProfileMusicTabProps) {
  const { muteItems } = useMuteList();

  const {
    data,
    isPending,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useProfileTracks(pubkey);

  const tracks = useMemo(() => {
    if (!data?.pages) return [];
    const seen = new Set<string>();

    return data.pages
      .flatMap((page) => page.events)
      .filter((event: NostrEvent) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        if (muteItems.length > 0 && isEventMuted(event, muteItems)) return false;
        return true;
      });
  }, [data?.pages, muteItems]);

  // A page can be entirely unparseable events; keep pulling while the visible
  // list is empty so the tab never looks broken when it has more to show.
  useEffect(() => {
    if (tracks.length === 0 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [tracks.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const { ref: scrollRef, inView } = useInView({ threshold: 0, rootMargin: '400px' });

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isPending) {
    return (
      <div>
        {Array.from({ length: 6 }).map((_, i) => (
          <MusicTrackRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="px-4 py-12 text-sm text-muted-foreground text-center">
        Failed to load tracks. Check your relay connections and try again.
      </p>
    );
  }

  if (tracks.length === 0) {
    return (
      <p className="px-4 py-12 text-sm text-muted-foreground text-center">
        No tracks to show.
      </p>
    );
  }

  return (
    <div className="pb-8">
      <div className="flex items-center gap-2 px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Music className="size-3.5" />
        <span>
          {tracks.length}
          {hasNextPage ? '+' : ''} {tracks.length === 1 ? 'track' : 'tracks'}
        </span>
      </div>

      {tracks.map((event, i) => (
        <MusicTrackRow key={event.id} event={event} index={i} />
      ))}

      {hasNextPage && (
        <div ref={scrollRef} className="py-4">
          {isFetchingNextPage && (
            <div className="flex justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
