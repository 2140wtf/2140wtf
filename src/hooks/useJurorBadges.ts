/**
 * useJurorBadges - NIP-58 badge display for jurors.
 *
 * Reads kind-8 badge acceptance events from the BAO Court relay and matches
 * them to a juror by the `d` tag carrying the juror pubkey (the court's
 * badge convention). Each observed event yields one badge name taken from
 * the `a` tag, falling back to the `name` tag.
 *
 * ## Trust model (security rounds 1 + 35)
 *
 * A kind-8 ACCEPTANCE event is published by the badge holder themselves
 * (NIP-58) — it is NOT a court-issued award. Events are therefore only
 * counted when they are SELF-published (`event.pubkey === jurorPubkey`),
 * so an attacker cannot mint a badge for another juror by publishing a
 * kind-8 with their pubkey in the `d` tag. The residual trust — the juror
 * self-accepting a badge name the court never awarded — is surfaced in the
 * UI as "self-reported" (see JurorDashboard) rather than silently trusted.
 *
 * Round 35 additions:
 *
 * - **Signature.** The event must pass `verifyEvent` — the relay is not a
 *   trust anchor, and a forged event claiming the juror's pubkey used to be
 *   enough to display an arbitrary badge.
 * - **NIP-58 `a` parsing.** A standard `a` tag is
 *   `30009:<badge-author-pubkey>:<identifier>`; the old parser split on the
 *   first `:` after the kind and displayed the *author's pubkey* as the badge
 *   name. The identifier is now used, with the court's 2-segment
 *   `30009:<identifier>` shorthand still supported.
 * - **Bounds.** At most {@link MAX_BADGES} distinct names are kept (the relay
 *   can return thousands of events regardless of `limit`), names are
 *   sanitised for bidi/control spoofing and capped, and the badge *definition*
 *   (`a` tag) is never fetched — a forged definition is accepted exactly as
 *   far as "this is what the juror claims", which is why the UI labels the
 *   whole block self-reported.
 * - **Expiry / revocation.** NIP-58 has no expiry, and revocation is a NIP-09
 *   deletion by the same author, which the relay — not this hook — enforces.
 *   Accepted behaviour: a revoked-but-still-served acceptance stays visible as
 *   self-reported until the relay stops serving it.
 */
import { useEffect, useState } from "react";
import { NRelay1, type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import { BAO_COURT_RELAY } from "@/lib/baoCourtRelays";
import { sanitizeDisplayText } from "@/lib/displayText";
import { isVerifiedEvent } from "@/lib/nostrEvents";

/** NIP-58 badge acceptance event kind. */
export const NIP58_BADGE_ACCEPTED_KIND = 8;

/** Display sanity cap for a badge name taken from hostile event tags. */
const MAX_BADGE_NAME_CHARS = 64;
/** Hard cap on retained badges (relay-returned count is attacker-controlled). */
export const MAX_BADGES = 32;
/** Relay query limit (a hint, not a guarantee — hence MAX_BADGES too). */
const QUERY_LIMIT = 100;

export interface JurorBadge {
  /** Badge id from the `a` tag (`30009:<identifier>`), or the `name` tag. */
  readonly name: string;
  readonly eventId: string;
  readonly awardedAt: number;
}

/**
 * The badge identifier from a kind-8 event, or null.
 *
 * Accepts both the standard NIP-58 `a` value
 * (`30009:<badge-author-pubkey>:<identifier>`) and the court's shorthand
 * (`30009:<identifier>`). The result is display-sanitised and length-capped,
 * so hostile tags cannot smuggle bidi reordering into the badge row.
 */
export function badgeNameFromEvent(event: NostrEvent): string | null {
  const aTag = event.tags?.find((t) => t[0] === "a")?.[1];
  if (typeof aTag === "string" && aTag.startsWith("30009:")) {
    const parts = aTag.slice("30009:".length).split(":");
    // Standard form: the last segment is the identifier; the middle one is the
    // badge AUTHOR's pubkey and must never be shown as the badge name.
    const identifier = parts.length >= 2 ? parts.slice(1).join(":") : parts[0];
    const name = sanitizeDisplayText(identifier, { maxChars: MAX_BADGE_NAME_CHARS });
    if (name) return name;
  }
  const nameTag = event.tags?.find((t) => t[0] === "name")?.[1];
  const fallback = sanitizeDisplayText(nameTag ?? "", { maxChars: MAX_BADGE_NAME_CHARS });
  return fallback || null;
}

export function useJurorBadges(jurorPubkey: string | null | undefined): JurorBadge[] {
  const [badges, setBadges] = useState<JurorBadge[]>([]);

  useEffect(() => {
    if (!jurorPubkey) return;
    const juror = jurorPubkey.toLowerCase();
    const relay = new NRelay1(BAO_COURT_RELAY);
    const controller = new AbortController();

    (async () => {
      try {
        const filter: NostrFilter = {
          kinds: [NIP58_BADGE_ACCEPTED_KIND],
          limit: QUERY_LIMIT,
        };
        const events = await relay.query([filter], { signal: controller.signal });
        if (controller.signal.aborted) return;
        const seen = new Set<string>();
        const byName = new Map<string, JurorBadge>();
        for (const event of events) {
          if (!event || typeof event.id !== "string" || seen.has(event.id)) continue;
          seen.add(event.id);
          // NIP-58 acceptance is self-published: only count events the
          // juror signed themselves (anti-spoofing; see header trust note).
          if (typeof event.pubkey !== "string" || event.pubkey.toLowerCase() !== juror) {
            continue;
          }
          // And the signature must actually be the juror's - a hostile relay
          // can otherwise mint any badge by writing the pubkey field.
          if (!isVerifiedEvent(event)) continue;
          // Court convention: the `d` tag carries the juror pubkey.
          const dTag = event.tags?.find((t) => t[0] === "d")?.[1];
          if (typeof dTag !== "string" || dTag.toLowerCase() !== juror) continue;
          const name = badgeNameFromEvent(event);
          if (!name) continue;
          // One entry per badge name (newest observation wins), hard-capped:
          // the relay can return thousands of events regardless of `limit`.
          const existing = byName.get(name);
          if (!existing || event.created_at > existing.awardedAt) {
            byName.set(name, { name, eventId: event.id, awardedAt: event.created_at });
          }
        }
        const found = [...byName.values()]
          .sort((a, b) => b.awardedAt - a.awardedAt)
          .slice(0, MAX_BADGES);
        setBadges(found);
      } catch {
        // Badges are decorative - best effort only.
      } finally {
        relay.close().catch(() => {});
      }
    })();

    return () => {
      controller.abort();
      relay.close().catch(() => {});
    };
  }, [jurorPubkey]);

  return badges;
}
