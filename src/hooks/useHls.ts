import { useRef, useEffect, useCallback } from 'react';
import type Hls from 'hls.js';

/**
 * Attaches hls.js to a video element for HLS streams on non-Safari browsers.
 *
 * The hook returns `isHls` so callers know whether the source is an HLS
 * stream. It sets `video.src` directly for Safari (native HLS) and for
 * non-HLS sources the caller remains responsible for assigning `src`.
 */
export function useHls(mediaRef: React.RefObject<HTMLMediaElement | null>, src: string) {
  const hlsRef = useRef<Hls | null>(null);

  const isHls = /\.m3u8(\?|$)/i.test(src);

  const attach = useCallback(() => {
    const media = mediaRef.current;
    if (!media || !isHls) return;

    // Safari supports HLS natively on both <audio> and <video> elements
    if (media.canPlayType('application/vnd.apple.mpegurl')) {
      media.src = src;
      return;
    }

    // Dynamically import hls.js to keep it out of the main bundle
    import('hls.js').then(({ default: HlsLib }) => {
      // Guard against stale closure (component unmounted or src changed)
      if (mediaRef.current !== media) return;
      if (!HlsLib.isSupported()) return;

      const hls = new HlsLib({ startLevel: -1, autoStartLoad: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(media);
    }).catch(() => {
      // hls.js is bundled; failure is unexpected. Ignore to keep video fallback.
    });
  }, [mediaRef, src, isHls]);

  useEffect(() => {
    attach();
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [attach]);

  return { isHls };
}
