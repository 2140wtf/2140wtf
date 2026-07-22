import { useRef, useEffect, useState, useCallback } from 'react';
import type Hls from 'hls.js';
import { Play, Pause, Volume1, Volume2, VolumeX, Expand, Minimize, Headphones, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BLANK_POSTER } from '@/lib/blankPoster';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { usePlayerControls } from '@/hooks/usePlayerControls';

interface LiveStreamPlayerProps {
  src: string;
  poster?: string;
  className?: string;
  /** Stream title shown in OS media controls. */
  title?: string;
  /** Artist / channel name shown in OS media controls. */
  artist?: string;
  /** Optional MIME type hint for the stream (e.g. "application/x-mpegURL", "audio/mpeg"). */
  mimeType?: string;
}

const HLS_MIME_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl'];

function isHlsStream(url?: string, mimeType?: string): boolean {
  if (mimeType) {
    const normalized = mimeType.toLowerCase();
    return HLS_MIME_TYPES.some((t) => normalized.includes(t));
  }
  return /\.m3u8(\?|$)/i.test(url ?? '');
}

export function LiveStreamPlayer({ src, poster, className, title, artist, mimeType }: LiveStreamPlayerProps) {
  const safeSrc = sanitizeUrl(src);
  const safePoster = sanitizeUrl(poster) || BLANK_POSTER;
  const isHls = isHlsStream(safeSrc, mimeType);
  const isAudioStream = mimeType ? mimeType.startsWith('audio/') : false;

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [audioOnly, setAudioOnly] = useState(isAudioStream);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const { showControls, revealControls, scheduleHide, isMuted, volume, toggleMute, handleVolumeChange } = usePlayerControls({
    mediaRef: videoRef,
    containerRef,
    isPlaying,
  });

  // Set up media source — HLS streams get hls.js (or native Safari HLS),
  // plain audio/video streams use the native media element directly.
  useEffect(() => {
    const media = videoRef.current;
    if (!media || !safeSrc) return;

    // Plain progressive stream (MP3, MP4, WebM, Icecast, etc.)
    if (!isHls) {
      media.src = safeSrc;
      media.play().catch(() => {
        setAutoplayBlocked(true);
      });
      return () => {
        media.pause();
        media.removeAttribute('src');
        media.load();
      };
    }

    // HLS: native support in Safari
    if (media.canPlayType('application/vnd.apple.mpegurl')) {
      media.src = safeSrc;
      media.play().catch(() => {
        setAutoplayBlocked(true);
      });
      return () => {
        media.pause();
        media.removeAttribute('src');
        media.load();
      };
    }

    let destroyed = false;

    import('hls.js').then(({ default: HlsLib }) => {
      if (destroyed) return;

      if (!HlsLib.isSupported()) {
        setHasError(true);
        return;
      }

      const hls = new HlsLib({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });

      hlsRef.current = hls;
      hls.loadSource(safeSrc);
      hls.attachMedia(media);

      hls.on(HlsLib.Events.MANIFEST_PARSED, () => {
        media.play().catch(() => {
          setAutoplayBlocked(true);
        });
      });

      hls.on(HlsLib.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case HlsLib.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case HlsLib.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setHasError(true);
              hls.destroy();
              break;
          }
        }
      });
    }).catch(() => {
      if (!destroyed) setHasError(true);
    });

    return () => {
      destroyed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [safeSrc, isHls]);

  // Track fullscreen changes
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Media Session API — registers OS lock-screen / notification controls for the live stream
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const video = videoRef.current;
    if (!video) return;

    const artwork: MediaImage[] = safePoster ? [{ src: safePoster, sizes: '512x512', type: 'image/jpeg' }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'Live Stream',
      artist: artist || '',
      artwork,
    });

    navigator.mediaSession.setActionHandler('play', () => video.play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => video.pause());
    // No seekto/previoustrack/nexttrack for a live stream
    navigator.mediaSession.setActionHandler('seekto', null);
    navigator.mediaSession.setActionHandler('previoustrack', null);
    navigator.mediaSession.setActionHandler('nexttrack', null);

    return () => {
      if (!('mediaSession' in navigator)) return;
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
    };
  }, [title, artist, safePoster]);

  // Keep OS playback state in sync
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const toggleAudioOnly = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setAudioOnly((prev) => !prev);
  }, []);

  const handleVideoClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (autoplayBlocked) {
      const video = videoRef.current;
      if (!video) return;
      video.play().then(() => {
        setAutoplayBlocked(false);
        setIsBuffering(false);
      }).catch(() => {});
      return;
    }
    // On the first tap, just reveal controls without toggling play/pause.
    // A second tap while controls are visible toggles play/pause.
    if (!showControls) {
      revealControls();
      return;
    }
    togglePlay(e);
    revealControls();
  }, [autoplayBlocked, showControls, togglePlay, revealControls]);

  const toggleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  if (hasError || !safeSrc) {
    return (
      <div className={cn('relative lg:rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center', className)}>
        <div className="text-center space-y-2 px-4">
          <p className="text-white/80 text-sm font-medium">Stream unavailable</p>
          <p className="text-white/50 text-xs">The live stream could not be loaded. It may have ended or the URL is unreachable.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative lg:rounded-2xl overflow-hidden bg-black group',
        audioOnly ? 'h-28 lg:h-32' : 'aspect-video',
        className,
      )}
      onMouseMove={revealControls}
      onMouseLeave={() => { if (isPlaying) scheduleHide(); }}
      onClick={(e) => e.stopPropagation()}
    >
      <video
        ref={videoRef}
        data-no-native-poster=""
        poster={safePoster}
        className={cn(
          'w-full h-full cursor-pointer',
          audioOnly ? 'opacity-0 absolute inset-0' : 'object-contain',
        )}
        playsInline
        autoPlay
        muted
        {...({ 'webkit-playsinline': 'true' } as React.HTMLAttributes<HTMLVideoElement>)}
        onClick={handleVideoClick}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
      />

      {/* Autoplay blocked — big centered play button */}
      {autoplayBlocked && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/40 cursor-pointer"
          onClick={handleVideoClick}
        >
          <div className="size-16 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm transition-transform hover:scale-110">
            <Play className="size-8 text-white ml-1" fill="white" />
          </div>
        </div>
      )}

      {/* Audio-only artwork / title overlay */}
      {audioOnly && (
        <div
          className="absolute inset-0 flex items-center px-4 gap-4 bg-cover bg-center cursor-pointer"
          style={{ backgroundImage: safePoster ? `url(${safePoster})` : undefined }}
          onClick={handleVideoClick}
        >
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative flex items-center gap-4 w-full">
            {safePoster && (
              <div className="hidden sm:block shrink-0">
                <img src={safePoster} alt="" className="w-16 h-16 rounded-lg object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-red-500 text-xs font-bold uppercase mb-1">
                <div className="size-1.5 bg-red-500 rounded-full animate-pulse" />
                Live
              </div>
              <p className="text-white font-medium truncate">{title || 'Live Stream'}</p>
              {artist && <p className="text-white/70 text-sm truncate">{artist}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Buffering spinner */}
      {isBuffering && !autoplayBlocked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="size-12 border-[3px] border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Bottom control bar */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 transition-opacity duration-200',
          'bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10 pb-3 px-4',
          (audioOnly || (showControls && !autoplayBlocked)) ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="text-white hover:text-white/80 transition-colors p-1"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="size-5" fill="white" /> : <Play className="size-5 ml-0.5" fill="white" />}
          </button>

          {/* LIVE badge */}
          <div className="flex items-center gap-1.5 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded">
            <div className="size-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </div>

          <div className="flex-1" />

          {/* Volume: icon toggles mute, slider sets level — identical to VideoPlayer */}
          <div className="flex items-center gap-1.5 group/vol">
            <button
              onClick={toggleMute}
              className="text-white hover:text-white/80 transition-colors shrink-0"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0
                ? <VolumeX className="size-5" />
                : volume < 0.5
                  ? <Volume1 className="size-5" />
                  : <Volume2 className="size-5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              onClick={(e) => e.stopPropagation()}
              aria-label="Volume"
              className={cn(
                'w-0 opacity-0 group-hover/vol:w-16 group-hover/vol:opacity-100 group-focus-within/vol:w-16 group-focus-within/vol:opacity-100',
                'transition-all duration-200 cursor-pointer accent-white h-1',
              )}
            />
          </div>

          {/* Audio-only toggle */}
          <button
            onClick={toggleAudioOnly}
            className="text-white hover:text-white/80 transition-colors p-1"
            aria-label={audioOnly ? 'Switch to video' : 'Switch to audio only'}
            title={audioOnly ? 'Switch to video' : 'Switch to audio only'}
          >
            {audioOnly ? <Monitor className="size-[18px]" /> : <Headphones className="size-[18px]" />}
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="text-white hover:text-white/80 transition-colors p-1"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize className="size-[18px]" /> : <Expand className="size-[18px]" />}
          </button>
        </div>
      </div>
    </div>
  );
}
