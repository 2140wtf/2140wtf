import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize2,
  X,
  GripVertical,
  Volume1,
  Volume2,
  VolumeX,
  Monitor,
  MonitorOff,
} from 'lucide-react';
import { useAudioPlayer } from '@/contexts/audioPlayerContextDef';
import { cn } from '@/lib/utils';

const POSITION_KEY = 'media-minibar-position';
const DRAG_THRESHOLD = 4;

function getStoredPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function getBottomOffset() {
  // On mobile (below sidebar breakpoint), reserve space for the bottom nav (56px)
  const hasSidebar = window.matchMedia('(min-width: 900px)').matches;
  return hasSidebar ? 0 : 56;
}

function clampToViewport(x: number, y: number, w: number, h: number) {
  const maxX = window.innerWidth - w;
  const maxY = window.innerHeight - h - getBottomOffset();
  return {
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(0, Math.min(y, maxY)),
  };
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url);
}

interface MinimizedMediaBarProps {
  mediaRef: React.RefObject<HTMLMediaElement | null>;
}

/**
 * Floating draggable mini-player.
 *
 * Renders a hidden media element whenever a track is loaded so playback
 * survives navigation. When minimized it shows the compact UI: an audio pill
 * for music/podcasts, or a video card (with audio-only toggle) for videos.
 */
export function MinimizedMediaBar({ mediaRef }: MinimizedMediaBarProps) {
  const player = useAudioPlayer();
  const {
    currentTrack, minimized, isPlaying, currentTime, duration, playlist, currentIndex,
    audioOnly, setAudioOnly,
  } = player;

  const navigate = useNavigate();
  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => {
    const stored = getStoredPosition();
    const defaultPos = { x: 16, y: window.innerHeight - 80 - getBottomOffset() };
    if (!stored) return defaultPos;
    return clampToViewport(stored.x, stored.y, 300, 64);
  });

  // Drag state
  const dragging = useRef(false);
  const dragStarted = useRef(false);
  const startPointer = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });

  // Reclamp on resize
  useEffect(() => {
    const onResize = () => {
      setPos((p) => {
        const el = barRef.current;
        const w = el?.offsetWidth ?? 300;
        const h = el?.offsetHeight ?? 64;
        return clampToViewport(p.x, p.y, w, h);
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Persist position
  useEffect(() => {
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
  }, [pos]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    dragStarted.current = false;
    startPointer.current = { x: e.clientX, y: e.clientY };
    startPos.current = { ...pos };
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - startPointer.current.x;
    const dy = e.clientY - startPointer.current.y;
    if (!dragStarted.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    dragStarted.current = true;

    const el = barRef.current;
    const w = el?.offsetWidth ?? 300;
    const h = el?.offsetHeight ?? 64;
    setPos(clampToViewport(startPos.current.x + dx, startPos.current.y + dy, w, h));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragging.current) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      dragging.current = false;
    }
  }, []);

  if (!currentTrack) return null;

  const isVideo = currentTrack.type === 'video';
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasPlaylist = playlist.length > 1;
  const canPrev = hasPlaylist && (currentIndex > 0 || currentTime > 3);
  const canNext = hasPlaylist && currentIndex < playlist.length - 1;

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      media.play().catch(() => {});
    } else {
      media.pause();
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const media = mediaRef.current;
    const bar = e.currentTarget;
    if (!media || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    media.currentTime = ratio * duration;
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const media = mediaRef.current;
    if (!media) return;
    media.muted = !media.muted;
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const media = mediaRef.current;
    if (!media) return;
    const v = parseFloat(e.target.value);
    media.volume = v;
    media.muted = v === 0;
    player.setVolume(v);
  };

  const mediaVolume = mediaRef.current ? (mediaRef.current.muted ? 0 : mediaRef.current.volume) : player.volume;
  const isMuted = mediaVolume === 0;

  return (
    <div
      ref={barRef}
      className={cn(
        'fixed z-30 select-none touch-none',
        !minimized && 'opacity-0 pointer-events-none',
      )}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {isVideo ? (
        <div className="flex flex-col w-72 rounded-2xl bg-background/95 backdrop-blur-md border border-border shadow-lg overflow-hidden">
          {/*
            Single video element: mounted at all times so playback survives
            navigation. Visually hidden when not minimized or in audio-only mode.
          */}
          <div className={cn('relative aspect-video bg-black', (!minimized || audioOnly) && 'h-0 overflow-hidden')}>
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={isHlsUrl(currentTrack.url) ? undefined : currentTrack.url}
              poster={currentTrack.poster ?? currentTrack.artwork}
              playsInline
              preload="metadata"
              className={cn('w-full h-full object-cover', (!minimized || audioOnly) && 'opacity-0')}
            />
          </div>

          {minimized && (
            <>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <div data-drag-handle className="cursor-grab active:cursor-grabbing shrink-0 p-1 -ml-0.5 text-muted-foreground/50 hover:text-muted-foreground">
                  <GripVertical className="size-4" />
                </div>

                <button
                  onClick={togglePlay}
                  className="shrink-0 p-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5 ml-0.5" fill="currentColor" />}
                </button>

                <div className="flex-1 min-w-0 px-1">
                  <p className="text-sm font-medium truncate leading-tight">{currentTrack.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{currentTrack.artist}</p>
                </div>

                <button
                  onClick={toggleMute}
                  className="shrink-0 p-1.5 rounded-full hover:bg-secondary transition-colors"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <VolumeX className="size-3.5" /> : mediaVolume < 0.5 ? <Volume1 className="size-3.5" /> : <Volume2 className="size-3.5" />}
                </button>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={mediaVolume}
                  onChange={handleVolumeChange}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Volume"
                  className="w-16 cursor-pointer accent-primary h-1"
                />

                <button
                  onClick={(e) => { e.stopPropagation(); setAudioOnly(!audioOnly); }}
                  className="shrink-0 p-1.5 rounded-full hover:bg-secondary transition-colors"
                  aria-label={audioOnly ? 'Show video' : 'Audio only'}
                  title={audioOnly ? 'Show video' : 'Audio only'}
                >
                  {audioOnly ? <Monitor className="size-3.5" /> : <MonitorOff className="size-3.5" />}
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    player.expand();
                    if (currentTrack.path) navigate(currentTrack.path);
                  }}
                  className="shrink-0 p-1.5 rounded-full hover:bg-secondary transition-colors"
                  aria-label="Expand"
                >
                  <Maximize2 className="size-3.5" />
                </button>

                <button
                  onClick={(e) => { e.stopPropagation(); player.stop(); }}
                  className="shrink-0 p-1.5 rounded-full hover:bg-secondary transition-colors"
                  aria-label="Close"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {/* Progress bar (VOD only) */}
              {duration > 0 && !audioOnly && (
                <div className="h-1 bg-border cursor-pointer" onClick={handleSeek}>
                  <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} preload="metadata" className="hidden" />
          {minimized && (
            <div className="flex flex-col">
              <div className="flex items-center gap-2 rounded-2xl bg-background/95 backdrop-blur-md border border-border shadow-lg px-2 py-1.5 min-w-[280px] max-w-[360px]">
                <div data-drag-handle className="cursor-grab active:cursor-grabbing shrink-0 p-1 -ml-0.5 text-muted-foreground/50 hover:text-muted-foreground">
                  <GripVertical className="size-4" />
                </div>

                {currentTrack.artwork ? (
                  <img src={currentTrack.artwork} alt="" className="size-10 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="size-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <Play className="size-4 text-primary" />
                  </div>
                )}

                <div className="flex-1 min-w-0 px-1">
                  <p className="text-sm font-medium truncate leading-tight">{currentTrack.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{currentTrack.artist}</p>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  {hasPlaylist && (
                    <button
                      onClick={() => player.prevTrack()}
                      disabled={!canPrev}
                      className="p-1.5 rounded-full hover:bg-secondary transition-colors disabled:opacity-30"
                      aria-label="Previous"
                    >
                      <SkipBack className="size-3.5" />
                    </button>
                  )}

                  <button
                    onClick={togglePlay}
                    className="p-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5 ml-0.5" fill="currentColor" />}
                  </button>

                  {hasPlaylist && (
                    <button
                      onClick={() => player.nextTrack()}
                      disabled={!canNext}
                      className="p-1.5 rounded-full hover:bg-secondary transition-colors disabled:opacity-30"
                      aria-label="Next"
                    >
                      <SkipForward className="size-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => {
                      player.expand();
                      if (currentTrack.path) navigate(currentTrack.path);
                    }}
                    className="p-1.5 rounded-full hover:bg-secondary transition-colors"
                    aria-label="Expand"
                  >
                    <Maximize2 className="size-3.5" />
                  </button>

                  <button
                    onClick={() => player.stop()}
                    className="p-1.5 rounded-full hover:bg-secondary transition-colors"
                    aria-label="Close"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>

              {/* Progress bar at bottom */}
              <div className="mx-3 h-0.5 rounded-full bg-border overflow-hidden -mt-0.5">
                <div className={cn('h-full bg-primary transition-[width] duration-200')} style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
