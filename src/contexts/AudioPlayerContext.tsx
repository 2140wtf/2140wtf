import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';

import { AudioPlayerContext, type AudioTrack } from '@/contexts/audioPlayerContextDef';
import { useHls } from '@/hooks/useHls';
import { MinimizedMediaBar } from '@/components/MinimizedMediaBar';

const VOLUME_KEY = 'audio-player-volume';

function getStoredVolume(): number {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    if (v !== null) {
      const n = parseFloat(v);
      if (isFinite(n) && n >= 0 && n <= 1) return n;
    }
  } catch { /* ignore */ }
  return 0.8;
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url);
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const pendingPlayRef = useRef<{ id: string; url: string } | null>(null);

  const [currentTrack, setCurrentTrack] = useState<AudioTrack | null>(null);
  const [playlist, setPlaylist] = useState<AudioTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(getStoredVolume);
  const [audioOnly, setAudioOnly] = useState(false);

  // Attach HLS support whenever the current track is a video with an HLS source.
  const currentUrl = currentTrack?.url ?? '';
  useHls(currentTrack?.type === 'video' ? mediaRef : { current: null }, currentUrl);

  // Start playback once the media element is mounted after the first play.
  // The <audio>/<video> element lives inside MinimizedMediaBar, which only
  // renders once currentTrack is set, so mediaRef is null at the moment the
  // user clicks play. This effect retries the pending play after commit.
  useLayoutEffect(() => {
    const media = mediaRef.current;
    const pending = pendingPlayRef.current;
    if (!media || !currentTrack || !pending || pending.id !== currentTrack.id) return;
    if (!isHlsUrl(currentTrack.url)) {
      media.src = currentTrack.url;
    }
    media.play().catch(() => {});
    pendingPlayRef.current = null;
  }, [currentTrack]);

  // Helper to assign src and play, or queue playback if the media element
  // hasn't mounted yet.
  const startPlayback = useCallback((track: AudioTrack, media: HTMLMediaElement | null) => {
    if (!media) {
      pendingPlayRef.current = { id: track.id, url: track.url };
      return;
    }
    pendingPlayRef.current = null;
    if (!isHlsUrl(track.url)) {
      media.src = track.url;
    }
    media.play().catch(() => {});
  }, []);

  // Sync volume to media element
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = volume;
  }, [volume]);

  // Media event listeners (work for both <audio> and <video>)
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      // Auto-advance playlist
      if (playlist.length > 0 && currentIndex < playlist.length - 1) {
        const next = currentIndex + 1;
        setCurrentIndex(next);
        setCurrentTrack(playlist[next]);
        if (!isHlsUrl(playlist[next].url)) {
          media.src = playlist[next].url;
        }
        media.play().catch(() => {});
      }
    };
    const onTimeUpdate = () => setCurrentTime(media.currentTime);
    const onDurationChange = () => {
      if (media.duration && isFinite(media.duration)) setDuration(media.duration);
    };

    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    media.addEventListener('ended', onEnded);
    media.addEventListener('timeupdate', onTimeUpdate);
    media.addEventListener('durationchange', onDurationChange);
    media.addEventListener('loadedmetadata', onDurationChange);

    return () => {
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('ended', onEnded);
      media.removeEventListener('timeupdate', onTimeUpdate);
      media.removeEventListener('durationchange', onDurationChange);
      media.removeEventListener('loadedmetadata', onDurationChange);
    };
  }, [playlist, currentIndex, currentTrack]);

  // Media Session API — populates Android/iOS notification panel with track info and controls
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artwork: MediaImage[] = currentTrack.artwork
      ? [{ src: currentTrack.artwork, sizes: '512x512', type: 'image/jpeg' }]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      artwork,
    });
  }, [currentTrack]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // Keep OS scrubber position in sync
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!currentTrack || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: mediaRef.current?.playbackRate ?? 1,
        position: Math.min(currentTime, duration),
      });
    } catch { /* setPositionState may throw on some browsers */ }
  }, [currentTime, duration, currentTrack]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const media = mediaRef.current;

    navigator.mediaSession.setActionHandler('play', () => media?.play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => media?.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (media && media.currentTime > 3) { media.currentTime = 0; return; }
      const prev = currentIndex - 1;
      if (prev < 0 || playlist.length === 0) return;
      setCurrentIndex(prev);
      setCurrentTrack(playlist[prev]);
      setCurrentTime(0);
      setDuration(playlist[prev].duration ?? 0);
      if (media && !isHlsUrl(playlist[prev].url)) { media.src = playlist[prev].url; }
      media?.play().catch(() => {});
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      const next = currentIndex + 1;
      if (next >= playlist.length) return;
      setCurrentIndex(next);
      setCurrentTrack(playlist[next]);
      setCurrentTime(0);
      setDuration(playlist[next].duration ?? 0);
      if (media && !isHlsUrl(playlist[next].url)) { media.src = playlist[next].url; }
      media?.play().catch(() => {});
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (media && details.seekTime != null) media.currentTime = details.seekTime;
    });

    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('seekto', null);
    };
  }, [currentIndex, playlist]);

  // beforeunload warning when playing
  useEffect(() => {
    if (!currentTrack) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [currentTrack]);

  const playTrack = useCallback((track: AudioTrack) => {
    setCurrentTrack(track);
    setPlaylist([]);
    setCurrentIndex(0);
    setMinimized(false);
    setAudioOnly(false);
    setCurrentTime(0);
    setDuration(track.duration ?? 0);
    startPlayback(track, mediaRef.current);
  }, [startPlayback]);

  const playVideoTrack = useCallback((track: AudioTrack) => {
    setCurrentTrack(track);
    setPlaylist([]);
    setCurrentIndex(0);
    setMinimized(true);
    setAudioOnly(false);
    setCurrentTime(0);
    setDuration(track.duration ?? 0);
    startPlayback(track, mediaRef.current);
  }, [startPlayback]);

  const playPlaylist = useCallback((tracks: AudioTrack[], startIndex = 0) => {
    if (tracks.length === 0) return;
    const idx = Math.max(0, Math.min(startIndex, tracks.length - 1));
    const track = tracks[idx];
    setPlaylist(tracks);
    setCurrentIndex(idx);
    setCurrentTrack(track);
    setMinimized(false);
    setAudioOnly(false);
    setCurrentTime(0);
    setDuration(track.duration ?? 0);
    startPlayback(track, mediaRef.current);
  }, [startPlayback]);

  const pause = useCallback(() => {
    mediaRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    mediaRef.current?.play().catch(() => {});
  }, []);

  const seek = useCallback((time: number) => {
    const media = mediaRef.current;
    if (media) media.currentTime = time;
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    try { localStorage.setItem(VOLUME_KEY, String(clamped)); } catch { /* ignore */ }
  }, []);

  const setAudioOnlyMode = useCallback((value: boolean) => {
    setAudioOnly(value);
  }, []);

  const nextTrack = useCallback(() => {
    const media = mediaRef.current;
    if (!media || playlist.length === 0) return;
    const next = currentIndex + 1;
    if (next >= playlist.length) return;
    setCurrentIndex(next);
    setCurrentTrack(playlist[next]);
    setCurrentTime(0);
    setDuration(playlist[next].duration ?? 0);
    if (!isHlsUrl(playlist[next].url)) {
      media.src = playlist[next].url;
    }
    media.play().catch(() => {});
  }, [playlist, currentIndex]);

  const prevTrack = useCallback(() => {
    const media = mediaRef.current;
    if (!media || playlist.length === 0) return;
    // If more than 3 seconds in, restart current track
    if (media.currentTime > 3) {
      media.currentTime = 0;
      return;
    }
    const prev = currentIndex - 1;
    if (prev < 0) return;
    setCurrentIndex(prev);
    setCurrentTrack(playlist[prev]);
    setCurrentTime(0);
    setDuration(playlist[prev].duration ?? 0);
    if (!isHlsUrl(playlist[prev].url)) {
      media.src = playlist[prev].url;
    }
    media.play().catch(() => {});
  }, [playlist, currentIndex]);

  const minimize = useCallback(() => setMinimized(true), []);

  const expand = useCallback(() => setMinimized(false), []);

  const stop = useCallback(() => {
    const media = mediaRef.current;
    if (media) {
      media.pause();
      media.src = '';
    }
    setCurrentTrack(null);
    setPlaylist([]);
    setCurrentIndex(0);
    setMinimized(false);
    setAudioOnly(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  return (
    <AudioPlayerContext.Provider
      value={{
        currentTrack, playlist, currentIndex, minimized, isPlaying, currentTime, duration, volume, audioOnly,
        playTrack, playVideoTrack, playPlaylist, pause, resume, seek, setVolume, setAudioOnly: setAudioOnlyMode,
        nextTrack, prevTrack, minimize, expand, stop,
      }}
    >
      {children}
      <MinimizedMediaBar mediaRef={mediaRef} />
    </AudioPlayerContext.Provider>
  );
}
