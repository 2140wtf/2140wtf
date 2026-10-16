/**
 * Track lyrics.
 *
 * There is no BAO/upstream NIP for lyrics, so this is a 2140.wtf convention on
 * the kind 36787 track event:
 *
 *   ["lyrics", "<plain text>"]            — plain lyrics (newlines allowed)
 *   ["synced_lyrics", "<LRC>"]            — time-synced lyrics in LRC format
 *
 * A player that finds neither tag simply shows no lyrics.
 */

import type { NostrEvent } from '@nostrify/nostrify';

/** A single time-stamped lyric line (LRC). */
export interface LrcLine {
  /** Time in seconds. */
  time: number;
  text: string;
}

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

/**
 * Parse an LRC string into time-stamped lines. Handles `[mm:ss.xx]` /
 * `[mm:ss]` (fractional hundredths/thousandths) and ignores metadata tags like
 * `[ar:…]`. Returns lines sorted by time.
 */
export function parseLrc(input: string | undefined): LrcLine[] {
  if (!input) return [];
  const lines: LrcLine[] = [];
  for (const raw of input.split('\n')) {
    const match = raw.match(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/);
    if (!match) continue;
    const minutes = Number.parseInt(match[1], 10);
    const seconds = Number.parseInt(match[2], 10);
    const fracRaw = match[3] ?? '0';
    const frac = Number.parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
    const text = match[4].trim();
    lines.push({ time: minutes * 60 + seconds + frac, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Extract a track's lyrics. `synced` is empty when there is no LRC. */
export function getTrackLyrics(event: NostrEvent): { plain?: string; synced: LrcLine[] } {
  return {
    plain: getTag(event, 'lyrics'),
    synced: parseLrc(getTag(event, 'synced_lyrics')),
  };
}

/** Index of the active line at `time` (the last line at or before it), or -1. */
export function activeLyricIndex(lines: LrcLine[], time: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= time + 0.15) idx = i;
    else break;
  }
  return idx;
}
