/**
 * Disappearing messages (NIP-40) for Concord V2 channels.
 *
 * A channel member picks a per-channel timer; every message they send while
 * it's active carries an `expiration` tag on BOTH the inner rumor (so every
 * member's client hides it after expiry — rumors are cached locally, so the
 * filter is what makes messages actually vanish from timelines) and the outer
 * stream wrap (so NIP-40-aware relays drop the ciphertext too).
 *
 * The timer is a sender-side, per-channel preference (localStorage). Any
 * member can run their own timer — there is no channel-wide consensus
 * setting. Disappearing is best-effort ephemerality, not a security
 * boundary: a modified client or a relay ignoring NIP-40 can keep copies.
 */

// ── Options ──────────────────────────────────────────────────────────────────

export interface DisappearOption {
  /** Seconds until expiry. */
  secs: number;
  /** Short chip label ("21 min"). */
  label: string;
}

/** The ₿AO ladder: 1 min, 21 min, 1 h, 4 h, 12 h, 21 h, 3 d, 7 d. */
export const DISAPPEAR_OPTIONS: DisappearOption[] = [
  { secs: 60, label: "1 min" },
  { secs: 21 * 60, label: "21 min" },
  { secs: 60 * 60, label: "1 hour" },
  { secs: 4 * 60 * 60, label: "4 hours" },
  { secs: 12 * 60 * 60, label: "12 hours" },
  { secs: 21 * 60 * 60, label: "21 hours" },
  { secs: 3 * 24 * 60 * 60, label: "3 days" },
  { secs: 7 * 24 * 60 * 60, label: "7 days" },
];

export { expirationOf, isExpired, ttlOf, ttlBadge } from "@/lib/expiration";

// ── Per-channel preference (localStorage) ────────────────────────────────────

const KEY_PREFIX = "concord2:disappear:";

/** The sender's active TTL for a channel, in seconds (undefined = off). */
export function getDisappearTtl(channelIdHex: string): number | undefined {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + channelIdHex);
    if (!raw) return undefined;
    const secs = Number(raw);
    return Number.isFinite(secs) && secs > 0 ? secs : undefined;
  } catch {
    return undefined;
  }
}

export function setDisappearTtl(channelIdHex: string, secs: number | undefined): void {
  try {
    if (secs === undefined) {
      localStorage.removeItem(KEY_PREFIX + channelIdHex);
    } else {
      localStorage.setItem(KEY_PREFIX + channelIdHex, String(secs));
    }
  } catch {
    // storage full / private mode — the timer just won't persist
  }
}
