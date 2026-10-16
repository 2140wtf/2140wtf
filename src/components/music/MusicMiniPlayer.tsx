/**
 * Sticky mini music player for the Music page.
 *
 * Shows the global player's current track with play/pause, seek, skip and a
 * link to the track's page — so playback is controllable on /music without
 * leaving the page (the floating mini-bar only appears once minimized).
 */

import { useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Music, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { useAudioPlayer } from '@/contexts/audioPlayerContextDef';
import { formatTime } from '@/lib/formatTime';

export function MusicMiniPlayer() {
  const player = useAudioPlayer();
  const { currentTrack, isPlaying, currentTime, duration, playlist } = player;
  const barRef = useRef<HTMLDivElement>(null);

  const handleSeek = useCallback((e: React.MouseEvent) => {
    const bar = barRef.current;
    if (!bar || duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.seek(ratio * duration);
  }, [duration, player]);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasPlaylist = playlist.length > 1;

  return (
    <div className="sticky bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md">
      <div className="flex items-center gap-3 px-3 py-2">
        <Link to={currentTrack.path ?? '/music'} className="shrink-0">
          {currentTrack.artwork ? (
            <img src={currentTrack.artwork} alt="" className="size-10 rounded-lg object-cover" />
          ) : (
            <div className="size-10 rounded-lg bg-primary/15 flex items-center justify-center">
              <Music className="size-5 text-primary/50" />
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0">
          <Link to={currentTrack.path ?? '/music'} className="block text-sm font-medium truncate hover:underline">
            {currentTrack.title}
          </Link>
          <p className="text-xs text-muted-foreground truncate">{currentTrack.artist}</p>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {hasPlaylist && (
            <button onClick={() => player.prevTrack()} className="p-2 rounded-full hover:bg-secondary transition-colors" aria-label="Previous">
              <SkipBack className="size-4" />
            </button>
          )}
          <button
            onClick={() => (isPlaying ? player.pause() : player.resume())}
            className="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 ml-0.5" fill="currentColor" />}
          </button>
          {hasPlaylist && (
            <button onClick={() => player.nextTrack()} className="p-2 rounded-full hover:bg-secondary transition-colors" aria-label="Next">
              <SkipForward className="size-4" />
            </button>
          )}
          <span className="hidden sm:block text-xs text-muted-foreground tabular-nums px-1 min-w-[70px] text-right">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <button onClick={() => player.stop()} className="p-2 rounded-full hover:bg-secondary transition-colors" aria-label="Close player">
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div
        ref={barRef}
        onClick={handleSeek}
        className="h-1 w-full bg-border cursor-pointer group/mp"
      >
        <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
