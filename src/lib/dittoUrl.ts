/**
 * Helpers for building 2140.wtf off-ramp URLs. Armada publishes profile and
 * (public) group/note events to Nostr, so any event or author it renders
 * has a fuller social view on 2140.wtf — images, quote posts, zaps, the
 * whole thread — that Armada's chat surfaces deliberately don't render.
 *
 * Shapes used:
 *   1. Addressable events (kind 30000–39999) → `/<naddr1…>` (stable across
 *      edits).
 *   2. Everything else (kind 1 notes, 1111 comments, …) → `/<nevent1…>`,
 *      which carries the author for relay hints.
 *   3. Profiles → `/<npub1…>` (the root resolver renders the profile).
 *   4. Hashtag timelines → `/t/<tag>`.
 *
 * The app's root resolver accepts any NIP-19 identifier at the path root, so
 * `2140.wtf/<nevent…>`, `2140.wtf/<naddr…>` and `2140.wtf/<npub…>` all
 * resolve.
 *
 * These wrap the non-throwing `safeNip19` encoders and return `undefined`
 * for malformed input (bad hex ids from untrusted event data) so callers
 * can simply skip the link rather than crash the render tree.
 */
import { tryNaddrEncode, tryNeventEncode, tryNpubEncode } from "@/lib/safeNip19";

import type { NostrEvent } from "@nostrify/nostrify";

const APP_ORIGIN = "https://2140.wtf";

/**
 * Off-ramp URL for a rendered event. Addressable events encode to an
 * `naddr` (stable across edits); everything else to an `nevent` carrying
 * the author pubkey as a relay hint. Returns `undefined` if the event has
 * a malformed id/pubkey.
 */
export function appEventUrl(event: NostrEvent): string | undefined {
  if (event.kind >= 30000 && event.kind < 40000) {
    const identifier = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const naddr = tryNaddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier,
    });
    return naddr ? `${APP_ORIGIN}/${naddr}` : undefined;
  }

  const nevent = tryNeventEncode({ id: event.id, author: event.pubkey });
  return nevent ? `${APP_ORIGIN}/${nevent}` : undefined;
}

/** Profile view on 2140.wtf. Returns `undefined` for a malformed pubkey. */
export function appProfileUrl(pubkey: string): string | undefined {
  const npub = tryNpubEncode(pubkey);
  return npub ? `${APP_ORIGIN}/${npub}` : undefined;
}

/** Hashtag timeline on 2140.wtf (`/t/<tag>`). Tags are lowercased to match. */
export function appHashtagUrl(tag: string): string {
  return `${APP_ORIGIN}/t/${encodeURIComponent(tag.toLowerCase())}`;
}

/**
 * Off-ramp for an arbitrary NIP-19 identifier (npub/note/nevent/naddr/…)
 * that already exists as a bech32 string. The app's root resolver renders
 * whatever the identifier points at, so this is the general fallback for
 * references Armada doesn't expand inline.
 */
export function appNip19Url(id: string): string {
  return `${APP_ORIGIN}/${id}`;
}
