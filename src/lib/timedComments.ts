import type { NostrEvent } from '@nostrify/nostrify';
import { formatTime } from '@/lib/formatTime';

/**
 * Tag that anchors a NIP-22 comment to a moment in an audio/video track,
 * SoundCloud-style. Value is a non-negative number of seconds (decimals
 * allowed), e.g. `["position", "185.4"]`.
 *
 * There is no upstream NIP for timed comments, so this is a 2140.wtf
 * convention applied to `kind:1111` comments whose root is an audio or video
 * event. See NIP.md → "Timed comments".
 */
export const TIMED_COMMENT_POSITION_TAG = 'position';

/** A comment anchored to a playback position. */
export interface TimedComment {
  /** The kind 1111 comment event. */
  event: NostrEvent;
  /** Playback position in seconds. */
  position: number;
}

/** Parses the `position` tag off a comment. Returns `undefined` when absent or invalid. */
export function getCommentPosition(event: NostrEvent): number | undefined {
  const raw = event.tags.find(([name]) => name === TIMED_COMMENT_POSITION_TAG)?.[1];
  if (raw === undefined) return undefined;
  const seconds = Number.parseFloat(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds;
}

/** Builds the extra NIP-22 tag that anchors a comment to a playback position. */
export function buildPositionTag(seconds: number): [string, string] {
  const clamped = Math.max(0, seconds);
  // One decimal keeps the payload compact while staying frame-accurate enough.
  return [TIMED_COMMENT_POSITION_TAG, clamped.toFixed(1)];
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

