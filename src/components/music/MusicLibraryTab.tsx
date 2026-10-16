/**
 * Library tab — the signed-in user's own music: tracks and playlists/albums,
 * with in-app create/edit.
 */

import { useState } from 'react';
import { ListMusic, Music, Plus, Upload } from 'lucide-react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { MusicTrackRow, MusicTrackRowSkeleton } from '@/components/music/MusicTrackRow';
import { MusicPlaylistCard } from '@/components/music/MusicPlaylistCard';
import { MusicTrackComposeDialog } from '@/components/music/MusicTrackComposeDialog';
import { MusicPlaylistComposeDialog } from '@/components/music/MusicPlaylistComposeDialog';
import { parseMusicTrack, parseMusicPlaylist } from '@/lib/musicHelpers';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * "Library" tab. Shows the user's own kind 36787 tracks and kind 34139
 * playlists/albums, with buttons to upload a track or create a playlist.
 */
export function MusicLibraryTab() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const [trackOpen, setTrackOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  const { data: tracks = [], isLoading: tracksLoading } = useQuery<NostrEvent[]>({
    queryKey: ['music', 'library-tracks', user?.pubkey ?? ''],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      if (!user) return [];
      const events = await nostr.query([{ kinds: [36787], authors: [user.pubkey], limit: 300 }], { signal });
      return events
        .filter((e) => parseMusicTrack(e) !== null)
        .sort((a, b) => b.created_at - a.created_at);
    },
  });

  const { data: playlists = [], isLoading: playlistsLoading } = useQuery<NostrEvent[]>({
    queryKey: ['music', 'library-playlists', user?.pubkey ?? ''],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      if (!user) return [];
      const events = await nostr.query([{ kinds: [34139], authors: [user.pubkey], limit: 300 }], { signal });
      return events
        .filter((e) => parseMusicPlaylist(e) !== null)
        .sort((a, b) => b.created_at - a.created_at);
    },
  });

  if (!user) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">Sign in to see your library.</p>;
  }

  return (
    <div className="pb-8">
      {/* Actions */}
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          onClick={() => setTrackOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Upload className="size-4" /> Upload track
        </button>
        <button
          onClick={() => setPlaylistOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-sm font-medium hover:bg-secondary/50 transition-colors"
        >
          <Plus className="size-4" /> New playlist
        </button>
      </div>

      {/* Your tracks */}
      <div className="px-4 mt-1 mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Music className="size-4" /> Your tracks <span className="text-xs opacity-70">{tracks.length}</span>
        </h3>
      </div>
      {tracksLoading ? (
        <div>{Array.from({ length: 3 }).map((_, i) => <MusicTrackRowSkeleton key={i} />)}</div>
      ) : tracks.length > 0 ? (
        <div>{tracks.map((ev, i) => <MusicTrackRow key={ev.id} event={ev} index={i} />)}</div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">No tracks yet. Use “Upload track”.</p>
      )}

      {/* Your playlists */}
      <div className="px-4 mt-6 mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ListMusic className="size-4" /> Your playlists <span className="text-xs opacity-70">{playlists.length}</span>
        </h3>
      </div>
      {playlistsLoading ? (
        <div className="flex gap-3 px-4 overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="w-[160px] shrink-0 aspect-square rounded-xl" />)}
        </div>
      ) : playlists.length > 0 ? (
        <div className="flex gap-3 px-4 overflow-x-auto">
          {playlists.map((ev) => <MusicPlaylistCard key={ev.id} event={ev} />)}
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">No playlists yet. Use “New playlist”.</p>
      )}

      <MusicTrackComposeDialog open={trackOpen} onOpenChange={setTrackOpen} />
      <MusicPlaylistComposeDialog open={playlistOpen} onOpenChange={setPlaylistOpen} />
    </div>
  );
}
