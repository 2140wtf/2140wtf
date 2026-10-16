import type { NostrEvent } from '@nostrify/nostrify';
import { formatTime } from '@/lib/formatTime';

/**
 * Tags that anchor a comment to a moment in an audio/video track,
 * SoundCloud-style. Value is a non-negative number of seconds.
 *
 * - `position` — 2140.wtf's NIP-22 (kind 1111) convention, decimals allowed
 *   (`["position", "185.4"]`).
 * - `timestamp` — the BAO music convention used by 2140 Sessions
 *   (`baocommunity/musicsessions`): kind 1 comments carry a whole-second
 *   `["timestamp", "185"]` alongside `e`/`p` tags. Read for ecosystem interop
 *   and written alongside `position`.
 *
 * See NIP.md → "Timed comments".
 */
export const TIMED_COMMENT_POSITION_TAG = 'position';
export const TIMED_COMMENT_TIMESTAMP_TAG = 'timestamp';
/** `t` value 2140 Sessions uses to mark a music comment (with no timestamp). */
export const MUSIC_COMMENT_MARKER_TAG = 'music-comment';

/** A comment anchored to a playback position. */
export interface TimedComment {
  /** The kind 1111 (NIP-22) or kind 1 (Sessions) comment event. */
  event: NostrEvent;
  /** Playback position in seconds. */
  position: number;
}

/**
 * Parses a playback position off a comment. Reads `position` (2140.wtf) first,
 * then `timestamp` (the 2140 Sessions / BAO music convention). Returns
 * `undefined` when neither is a valid non-negative number.
 */
export function getCommentPosition(event: NostrEvent): number | undefined {
  const raw = event.tags.find(([name]) => name === TIMED_COMMENT_POSITION_TAG)?.[1]
    ?? event.tags.find(([name]) => name === TIMED_COMMENT_TIMESTAMP_TAG)?.[1];
  if (raw === undefined) return undefined;
  const seconds = Number.parseFloat(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds;
}

/** True when a comment is a 2140 Sessions music comment (`timestamp` tag or `t=music-comment`). */
export function isMusicComment(event: NostrEvent): boolean {
  return event.tags.some(([n]) => n === TIMED_COMMENT_TIMESTAMP_TAG)
    || event.tags.some(([n, v]) => n === 't' && v === MUSIC_COMMENT_MARKER_TAG);
}

/**
 * Builds the extra tags that anchor a comment to a playback position.
 *
 * Emits both `position` (2140.wtf) and `timestamp` (2140 Sessions / BAO music)
 * so the comment is readable by either client, plus the `t=music-comment`
 * marker 2140 Sessions recognises.
 */
export function buildCommentPositionTags(seconds: number): [string, string][] {
  const clamped = Math.max(0, seconds);
  // `position` keeps one decimal (frame-accurate); `timestamp` is whole
  // seconds to match what 2140 Sessions reads.
  return [
    [TIMED_COMMENT_POSITION_TAG, clamped.toFixed(1)],
    [TIMED_COMMENT_TIMESTAMP_TAG, String(Math.floor(clamped))],
    ['t', MUSIC_COMMENT_MARKER_TAG],
  ];
}

/** Builds just the 2140.wtf `position` tag (kept for callers that only need it). */
export function buildPositionTag(seconds: number): [string, string] {
  const clamped = Math.max(0, seconds);
  return [TIMED_COMMENT_POSITION_TAG, clamped.toFixed(1)];
}

/** A positioned comment plus the lane it should be drawn in. */
export interface TimedCommentLayout {
  comment: TimedComment;
  /** Horizontal position, 0–100 (% of duration). */
  position: number;
  /** Vertical lane (0 = baseline). Comments that would overlap horizontally
   *  are pushed into successive lanes so they stack instead of hiding. */
  lane: number;
}

/**
 * Lay out timed comments for a waveform: sorts by position and assigns each to
 * the lowest lane whose previous marker is at least `minGapPct` away. Comments
 * within the gap of each other therefore stack vertically, SoundCloud-style.
 */
export function layoutTimedComments(
  comments: TimedComment[],
  duration: number,
  minGapPct = 1.6,
  maxLanes = Number.POSITIVE_INFINITY,
): TimedCommentLayout[] {
  const sorted = [...comments].sort((a, b) => a.position - b.position);
  const laneEnds: number[] = [];
  return sorted.map((comment) => {
    const pct = duration > 0 ? Math.min(100, Math.max(0, (comment.position / duration) * 100)) : 0;
    let lane = laneEnds.findIndex((endPct) => pct - endPct >= minGapPct);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(pct);
    } else {
      laneEnds[lane] = pct;
    }
    // Cap the lane so a very hot track doesn't stack avatars off the surface.
    return { comment, position: pct, lane: Math.min(lane, maxLanes - 1) };
  });
}


/** Formats a playback position for display (`m:ss`). */
export function formatCommentPosition(seconds: number): string {
  return formatTime(seconds);
}

/**
 * Parses a human-typed playback position into seconds.
 *
 * Accepts `m:ss`, `h:mm:ss`, or a bare number of seconds (`185`, `185.4`).
 * Returns `undefined` for anything that isn't a valid non-negative time.
 */
export function parseCommentPosition(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  // Bare seconds: "185" / "185.4"
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number.parseFloat(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  }

  // Colon form: "m:ss" or "h:mm:ss"
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p.trim() === '')) {
    return undefined;
  }
  const nums = parts.map((p) => Number.parseFloat(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const seconds = parts.length === 3
    ? nums[0] * 3600 + nums[1] * 60 + nums[2]
    : nums[0] * 60 + nums[1];
  return Number.isFinite(seconds) ? seconds : undefined;
}

