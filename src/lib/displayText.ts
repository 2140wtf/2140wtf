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
 *
 * ## Round 36 (cost + leftovers)
 *
 * - **Bounded work.** Round 35 cleaned the whole input and only THEN capped it
 *   to `maxChars` (`Array.from(wholeString)`), so a hostile multi-megabyte tag
 *   cost O(n) code points and an O(n) array per render — and the court hooks
 *   re-render on every relay flush. The single pass below stops as soon as the
 *   cap is reached, so work is O(maxChars), never O(input).
 * - **Invisible leftovers.** The strip set now also covers the soft hyphen
 *   (U+00AD), the Mongolian vowel separator (U+180E), the invisible filler
 *   code points (U+115F/U+1160/U+2800/U+3164/U+FFA0) and the full
 *   U+2060..U+2069 run — all of which render as nothing and are classic
 *   "make two strings look the same" bait.
 * - **Truncation never leaves a dangling mark.** A cap that falls inside a
 *   combining sequence used to keep the accent/variation selector, which then
 *   rendered over the ellipsis (or over the next cell). Trailing combining
 *   marks and variation selectors are dropped before the ellipsis is added.
 *
 * ## Accepted behaviour (deliberate)
 *
 * - **Homoglyphs are NOT stripped.** A Cyrillic `У` that looks like `Y` still
 *   renders as `У`. Confusable folding needs a Unicode confusables table and
 *   would mangle legitimate non-Latin text (court outcomes and market titles
 *   are user text, not identifiers); the trust decision never reads this
 *   string. Rows that must be machine-compared use `shortIdentifier` on a hex
 *   id, where the alphabet is ASCII-only.
 * - **No semantic normalisation.** NFD/NFC, case folding and script mixing are
 *   out of scope for the same reason: this is a *display* guard.
 */

/**
 * Unicode bidi / isolation controls + invisible fillers (Trojan Source),
 * anchored to a single code point: the single-pass loop below tests one code
 * point at a time (a global regex would be stateful under `.test`).
 */
const SINGLE_INVISIBLE =
  /^[\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\u2800\u3164\uFEFF\uFFA0]$/;
/**
 * C0 + C1 control characters (kept as a code-point test rather than a
 * regex character range so the file needs no `no-control-regex` exemption).
 */
function isControlCodePoint(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}
/** Unicode whitespace (any script's space, including NBSP and U+3000). */
const WHITESPACE_ONE = /^\s$/;
/**
 * Code points that render *onto the previous glyph* instead of occupying their
 * own cell: combining diacritics and variation selectors. Only consulted when
 * the cap cuts a string, to avoid a mark glued to the inserted ellipsis.
 * (A code-point test rather than a regex class, so no
 * `no-misleading-character-class` exemption is needed.)
 */
function isTrailingMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f)
    || (code >= 0x0483 && code <= 0x0489)
    || (code >= 0x1ab0 && code <= 0x1aff)
    || (code >= 0x1dc0 && code <= 0x1dff)
    || (code >= 0x20d0 && code <= 0x20f0)
    || (code >= 0xfe00 && code <= 0xfe0f)
    || (code >= 0xfe20 && code <= 0xfe2f)
  );
}

export interface SanitizeDisplayOptions {
  /** Maximum number of unicode code points retained (default 64). */
  readonly maxChars?: number;
}

/** Drop trailing combining marks / variation selectors, then add the ellipsis. */
function truncatedText(text: string): string {
  const points = Array.from(text);
  while (points.length > 0) {
    const last = points[points.length - 1]!;
    if (!isTrailingMark(last.codePointAt(0) ?? 0)) break;
    points.pop();
  }
  return `${points.join("")}…`;
}

/**
 * Return a layout-safe, single-line, length-capped rendering of `value`.
 *
 * Anything that is not a string (or is a string of only controls/whitespace)
 * becomes "" — callers render nothing rather than a placeholder, so hostile
 * input can never impersonate a real value.
 *
 * Work is bounded by `maxChars`, not by the input length: the loop returns as
 * soon as the cap is reached (see the round-36 note in the file header).
 */
export function sanitizeDisplayText(
  value: unknown,
  options: SanitizeDisplayOptions = {},
): string {
  if (typeof value !== "string") return "";
  const maxChars = options.maxChars ?? 64;
  let out = "";
  let emitted = 0;
  let pendingSpace = false;
  // `for…of` walks code points, so a surrogate pair is never split.
  for (const char of value) {
    if (SINGLE_INVISIBLE.test(char)) continue;
    const code = char.codePointAt(0) ?? 0;
    if (isControlCodePoint(code) || WHITESPACE_ONE.test(char)) {
      // Collapse runs of whitespace and controls into one separator, and never
      // start a value with one.
      if (emitted > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      if (emitted >= maxChars) return truncatedText(out);
      out += " ";
      emitted += 1;
      pendingSpace = false;
    }
    if (emitted >= maxChars) return truncatedText(out);
    out += char;
    emitted += 1;
  }
  return out;
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
  return truncatedText(points.slice(0, chars).join(""));
}
