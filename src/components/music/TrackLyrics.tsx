/**
 * Collapsible lyrics section for a track.
 *
 * Renders time-synced (LRC) lyrics with the active line highlighted while the
 * track plays, or plain lyrics otherwise. Hidden entirely when the track has
 * no lyrics tags.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Mic2 } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

import { getTrackLyrics, activeLyricIndex } from '@/lib/lyrics';
import { cn } from '@/lib/utils';

interface TrackLyricsProps {
  event: NostrEvent;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Whether this track is the one currently playing. */
  isPlaying: boolean;
}

export function TrackLyrics({ event, currentTime, isPlaying }: TrackLyricsProps) {
  const { plain, synced } = useMemo(() => getTrackLyrics(event), [event]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeIndex = useMemo(
    () => (isPlaying ? activeLyricIndex(synced, currentTime) : -1),
    [isPlaying, synced, currentTime],
  );

  // Keep the active line in view while playing.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-line="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [open, activeIndex]);

  if (!plain && synced.length === 0) return null;

  return (
    <div className="px-4 mt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <Mic2 className="size-4" />
        Lyrics
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div ref={containerRef} className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-border bg-muted/20 p-4">
          {synced.length > 0 ? (
            <div className="space-y-1.5">
              {synced.map((line, i) => (
                <p
                  key={`${line.time}-${i}`}
                  data-line={i}
                  className={cn(
                    'text-sm leading-relaxed transition-colors',
                    i === activeIndex ? 'text-primary font-medium' : 'text-muted-foreground',
                  )}
                >
                  {line.text || '♪'}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{plain}</p>
          )}
        </div>
      )}
    </div>
  );
}
