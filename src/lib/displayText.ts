/**
 * displayText - one sanitizer for attacker-controlled strings that reach the
 * DOM as *text* (React escapes markup, but not spoofing).
 *
 * Security round 35: the court surfaces render several values that come
 * straight out of relay event tags (`caseId`, `proposedOutcome`, badge names,
 * verification reasons). React escapes them, so `<script>` cannot execute —
 * but a hostile event could still:
 *
 * - smuggle Unicode bidi controls (U+202A..U+202E, U+2066..U+2069, U+200E/F,
 *   U+061C) to visually reverse or reorder a status row (Trojan Source),
 * - inject zero-width characters to make two different case ids look
 *   identical, or to make a value look truncated when it is not,
 * - carry C0/C1 control characters that break row layout,
 * - be megabytes long, blowing up layout / memory in a status row.
 *
 * `sanitizeDisplayText` is a *display* guard, never a trust decision: it never
 * turns an untrusted value into a trusted one.
 */

/** Unicode bidi / isolation controls (Trojan Source). */
const BIDI_AND_INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
/**
 * C0 + C1 control characters (kept as a code-point test rather than a
 * regex character range so the file needs no `no-control-regex` exemption).
 */
function isControlCodePoint(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}
/** Runs of whitespace, collapsed so a value cannot fake vertical space. */
const WHITESPACE_RUN = /\s+/g;

export interface SanitizeDisplayOptions {
  /** Maximum number of unicode code points retained (default 64). */
  readonly maxChars?: number;
}

/**
 * Return a layout-safe, single-line, length-capped rendering of `value`.
 *
 * Anything that is not a string (or is a string of only controls/whitespace)
 * becomes "" — callers render nothing rather than a placeholder, so hostile
 * input can never impersonate a real value.
 */
export function sanitizeDisplayText(
  value: unknown,
  options: SanitizeDisplayOptions = {},
): string {
  if (typeof value !== "string") return "";
  const maxChars = options.maxChars ?? 64;
  const withoutBidi = value.replace(BIDI_AND_INVISIBLE, "");
  // Replace control characters code point by code point (no control-char
  // regex class, so no lint exemption is needed).
  let controlSafe = "";
  for (const char of withoutBidi) {
    controlSafe += isControlCodePoint(char.codePointAt(0) ?? 0) ? " " : char;
  }
  const cleaned = controlSafe
    .replace(WHITESPACE_RUN, " ")
    .trim();
  if (cleaned.length === 0) return "";
  // Cap by CODE POINT (not UTF-16 unit) so a surrogate pair is never split
  // into a lone half that renders as U+FFFD.
  const points = Array.from(cleaned);
  if (points.length <= maxChars) return cleaned;
  return `${points.slice(0, maxChars).join("")}…`;
}

/**
 * Shorten a hex-ish identifier for display: first `chars` code points plus an
 * ellipsis when truncated. Uses the same guards as {@link sanitizeDisplayText}.
 */
export function shortIdentifier(value: unknown, chars = 16): string {
  // Cap generously first (bounds work on a hostile megabyte), then shorten.
  const safe = sanitizeDisplayText(value, { maxChars: 256 });
  if (safe === "") return "";
  const points = Array.from(safe);
  if (points.length <= chars) return safe;
  return `${points.slice(0, chars).join("")}…`;
}
