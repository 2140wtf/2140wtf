import { useEffect, useState } from 'react';

import { computePeaks, getCachedPeaks, WAVEFORM_BARS } from '@/lib/audioPeaks';

/**
 * Returns normalised waveform peaks for an audio URL, or `undefined` until
 * they are available.
 *
 * Decoding downloads and decodes the whole file, so `enabled` gates the work:
 * only turn it on for the now-playing track, a hovered row, or a detail page.
 * Cached peaks are returned synchronously (no flash of empty waveform).
 */
export function useWaveformPeaks(url: string | undefined, enabled: boolean, bars = WAVEFORM_BARS): number[] | undefined {
  const [peaks, setPeaks] = useState<number[] | undefined>(() => getCachedPeaks(url));

  useEffect(() => {
    if (!url) {
      setPeaks(undefined);
      return;
    }
    const cached = getCachedPeaks(url);
    if (cached) {
      setPeaks(cached);
      return;
    }
    if (!enabled) return;

    // Debounce: a quick pass of the pointer over many rows shouldn't kick off
    // a download+decode for each one.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void computePeaks(url, bars)
        .then((result) => { if (!cancelled && result) setPeaks(result); })
        .catch(() => { /* leave undefined — caller renders a flat baseline */ });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [url, enabled, bars]);

  return peaks;
}
