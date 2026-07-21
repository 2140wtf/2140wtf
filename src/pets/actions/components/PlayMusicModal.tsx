// src/pets/actions/components/PlayMusicModal.tsx

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Music, Play, Pause, Check, Loader2, Volume2, AlertCircle } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useMusicFeed } from '@/hooks/useMusicFeed';
import { parseMusicTrack } from '@/lib/musicHelpers';

import {
  getAllTracks,
  formatTrackDuration,
  type PetsTrack,
} from '../lib/pets-track-catalog';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Selected track for the music player
 */
export interface SelectedTrack {
  track: PetsTrack;
  url: string;
}

interface PlayMusicModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the selected track when user confirms */
  onConfirm: (selection: SelectedTrack) => void;
  isLoading: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlayMusicModal({
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: PlayMusicModalProps) {
  const [selectedTrack, setSelectedTrack] = useState<SelectedTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'catalog' | 'nostr'>('catalog');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Track the current audio source URL to detect changes
  const currentAudioUrlRef = useRef<string | null>(null);

  const tracks = getAllTracks();

  const {
    data: nostrFeed,
    isLoading: isNostrLoading,
    isError: isNostrError,
  } = useMusicFeed({
    kind: 36787,
    sort: 'hot',
    scope: 'global',
    enabled: open && tab === 'nostr',
  });

  const nostrEvents = useMemo(() => nostrFeed?.pages.flat() ?? [], [nostrFeed]);
  
  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);
  
  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSelectedTrack(null);
      setIsPlaying(false);
      setError(null);
      setTab('catalog');
      currentAudioUrlRef.current = null;
    }
  }, [open]);
  
  // Handle selecting a track
  const handleSelectTrack = useCallback((track: PetsTrack) => {
    // Stop current playback
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    setSelectedTrack({ track, url: track.url });
    setError(null);
  }, []);

  // Handle selecting a Nostr music event
  const handleSelectNostrEvent = useCallback((event: NostrEvent) => {
    const parsed = parseMusicTrack(event);
    if (!parsed) return;

    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    const track: PetsTrack = {
      id: event.id,
      title: parsed.title,
      artist: parsed.artist,
      url: parsed.url,
      durationSeconds: parsed.duration && Number.isFinite(parsed.duration) ? parsed.duration : 0,
      coverArt: parsed.artwork,
      format: parsed.format,
      tags: parsed.format ? [parsed.format] : undefined,
    };

    setSelectedTrack({ track, url: parsed.url });
    setError(null);
  }, []);

  // Handle play/pause preview
  const handleTogglePlay = useCallback(() => {
    if (!selectedTrack) return;
    
    const audioUrl = selectedTrack.url;
    
    // Check if we need to create a new Audio instance (source changed or first time)
    const needsNewAudio = !audioRef.current || currentAudioUrlRef.current !== audioUrl;
    
    if (needsNewAudio) {
      // Stop and cleanup old audio if exists
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
      }
      
      // Create new Audio instance with the correct source
      audioRef.current = new Audio(audioUrl);
      currentAudioUrlRef.current = audioUrl;
      
      audioRef.current.onended = () => setIsPlaying(false);
      audioRef.current.onerror = () => {
        setError('Failed to load this track. Please try another one.');
        setIsPlaying(false);
      };
    }
    
    if (isPlaying && !needsNewAudio) {
      // Pause current playback
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      // Start playback (either new source or resuming)
      audioRef.current?.play().catch(() => {
        setError('Failed to play this track. Please try another one.');
        setIsPlaying(false);
      });
      setIsPlaying(true);
    }
  }, [selectedTrack, isPlaying]);
  
  // Handle confirm
  const handleConfirm = useCallback(() => {
    if (!selectedTrack) return;
    
    // Stop playback
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    onConfirm(selectedTrack);
  }, [selectedTrack, onConfirm]);
  
  // Handle close
  const handleClose = useCallback((isOpen: boolean) => {
    if (!isOpen && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    onOpenChange(isOpen);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-pink-500/20 to-pink-500/5 flex items-center justify-center">
              <Music className="size-5 text-pink-500" />
            </div>
            <div>
              <DialogTitle className="text-xl">Play Music</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Choose real music from Nostr or a sample track
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Tabs */}
        <div className="px-6 pt-4">
          <div className="flex p-1 rounded-lg bg-muted">
            <button
              type="button"
              onClick={() => setTab('catalog')}
              className={cn(
                'flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                tab === 'catalog'
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Sample Tracks
            </button>
            <button
              type="button"
              onClick={() => setTab('nostr')}
              className={cn(
                'flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                tab === 'nostr'
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Nostr Music
            </button>
          </div>
        </div>

        {/* Content - Track List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === 'catalog' ? (
            <div className="grid gap-2">
              {tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  isSelected={selectedTrack?.track.id === track.id}
                  onSelect={() => handleSelectTrack(track)}
                />
              ))}
            </div>
          ) : (
            <NostrTrackList
              events={nostrEvents}
              isLoading={isNostrLoading}
              isError={isNostrError}
              selectedId={selectedTrack?.track.id}
              onSelect={handleSelectNostrEvent}
            />
          )}
          {error && (
            <div className="mt-4 p-3 rounded-lg bg-amber-100 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800">
              <div className="flex items-start gap-2">
                <AlertCircle className="size-4 text-amber-800 dark:text-amber-200 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-950 dark:text-amber-100">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-muted/30">
          {/* Preview Controls */}
          {selectedTrack && (
            <div className="mb-4 p-3 rounded-lg bg-card border">
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleTogglePlay}
                  className="size-10 rounded-full shrink-0"
                >
                  {isPlaying ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4 ml-0.5" />
                  )}
                </Button>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm">{selectedTrack.track.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {isPlaying ? 'Now playing...' : 'Click to preview'}
                  </p>
                </div>
                {isPlaying && (
                  <Volume2 className="size-4 text-primary animate-pulse shrink-0" />
                )}
              </div>
            </div>
          )}
          
          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              className="flex-1"
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!selectedTrack || isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Playing...
                </>
              ) : (
                <>
                  <Music className="size-4 mr-2" />
                  Play for NOSTR PETS
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Track Row Component ──────────────────────────────────────────────────────

interface TrackRowProps {
  track: PetsTrack;
  isSelected: boolean;
  onSelect: () => void;
}

function TrackRow({ track, isSelected, onSelect }: TrackRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full p-3 rounded-xl text-left transition-all",
        "border hover:border-primary/30",
        isSelected 
          ? "border-primary bg-primary/5 ring-2 ring-primary/20" 
          : "border-border bg-card/60"
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          "size-10 rounded-lg flex items-center justify-center",
          isSelected ? "bg-primary/20" : "bg-muted"
        )}>
          <Music className={cn(
            "size-5",
            isSelected ? "text-primary" : "text-muted-foreground"
          )} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{track.title}</p>
          <p className="text-sm text-muted-foreground">{track.artist}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">
            {formatTrackDuration(track.durationSeconds)}
          </span>
          {isSelected && <Check className="size-4 text-primary" />}
        </div>
      </div>
    </button>
  );
}
// ─── Nostr Track List Component ───────────────────────────────────────────────

interface NostrTrackListProps {
  events: NostrEvent[];
  isLoading: boolean;
  isError: boolean;
  selectedId: string | undefined;
  onSelect: (event: NostrEvent) => void;
}

function NostrTrackList({ events, isLoading, isError, selectedId, onSelect }: NostrTrackListProps) {
  if (isLoading && events.length === 0) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/60">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Failed to load music from Nostr.
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No music tracks found on Nostr yet.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {events.map((event) => {
        const parsed = parseMusicTrack(event);
        if (!parsed) return null;
        const isSelected = selectedId === event.id;
        return (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelect(event)}
            className={cn(
              'w-full p-3 rounded-xl text-left transition-all',
              'border hover:border-primary/30',
              isSelected
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-border bg-card/60'
            )}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                'size-10 rounded-lg flex items-center justify-center',
                isSelected ? 'bg-primary/20' : 'bg-muted'
              )}>
                <Music className={cn(
                  'size-5',
                  isSelected ? 'text-primary' : 'text-muted-foreground'
                )} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{parsed.title}</p>
                <p className="text-sm text-muted-foreground">{parsed.artist}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {parsed.duration && parsed.duration > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {formatTrackDuration(parsed.duration)}
                  </span>
                )}
                {isSelected && <Check className="size-4 text-primary" />}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
