/**
 * Audio peak extraction for SoundCloud-style waveform diagrams.
 *
 * Music-track events carry no precomputed waveform (unlike NIP-A0 voice
 * messages), so we decode the audio in the browser with the Web Audio API and
 * downsample the first channel into a fixed number of normalised peaks.
 *
 * Peaks are cached in memory and in localStorage, keyed by URL, so a track is
 * decoded at most once per browser. Decoding downloads the whole file, so
 * callers MUST gate it behind `enabled` (e.g. the now-playing track, a row the
 * user is hovering, or a detail page) rather than running it for every item.
 */

/** Number of bars in a waveform diagram. */
export const WAVEFORM_BARS = 160;

const CACHE_VERSION = 'v1';
const MEMORY = new Map<string, number[]>();
const INFLIGHT = new Map<string, Promise<number[] | undefined>>();

/** Lazily-created shared AudioContext (browsers cap how many you may create). */
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedCtx) return sharedCtx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
  } catch {
    return null;
  }
  return sharedCtx;
}

function cacheKey(url: string): string {
  return `audio-peaks:${CACHE_VERSION}:${url}`;
}

/** Returns already-computed peaks for a URL, if present in memory or storage. */
export function getCachedPeaks(url: string | undefined): number[] | undefined {
  if (!url) return undefined;
  const mem = MEMORY.get(url);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(cacheKey(url));
    if (!raw) return undefined;
    // Stored as 0–100 integers for a compact payload — scale back to 0..1.
    const parsed = raw.split(',').map((s) => Number(s) / 100).filter((n) => Number.isFinite(n));
    if (parsed.length === 0) return undefined;
    MEMORY.set(url, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function storePeaks(url: string, peaks: number[]): void {
  MEMORY.set(url, peaks);
  try {
    localStorage.setItem(cacheKey(url), peaks.map((p) => Math.round(p * 100)).join(','));
  } catch {
    // Quota exceeded or storage disabled — the in-memory cache still works.
  }
}

/**
 * Decodes `url` and returns `bars` normalised peaks (0..1), or `undefined`
 * when the audio can't be fetched/decoded (CORS, unsupported codec, etc.).
 * Concurrent requests for the same URL share one decode.
 */
export function computePeaks(url: string, bars = WAVEFORM_BARS): Promise<number[] | undefined> {
  const cached = getCachedPeaks(url);
  if (cached) return Promise.resolve(cached);

  const existing = INFLIGHT.get(url);
  if (existing) return existing;

  const job = (async (): Promise<number[] | undefined> => {
    const ctx = getAudioContext();
    if (!ctx) return undefined;
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return undefined;
    const buffer = await response.arrayBuffer();
    // decodeAudioData detaches the buffer, so pass it directly.
    const decoded = await ctx.decodeAudioData(buffer);
    const channel = decoded.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / bars));
    const peaks: number[] = [];
    let max = 0;
    for (let i = 0; i < bars; i++) {
      const start = i * block;
      const end = Math.min(start + block, channel.length);
      let sum = 0;
      for (let j = start; j < end; j++) sum += Math.abs(channel[j]);
      const value = end > start ? sum / (end - start) : 0;
      peaks.push(value);
      if (value > max) max = value;
    }
    const normalized = max > 0 ? peaks.map((p) => p / max) : peaks;
    storePeaks(url, normalized);
    return normalized;
  })();

  INFLIGHT.set(url, job);
  void job.finally(() => INFLIGHT.delete(url));
  return job;
}
