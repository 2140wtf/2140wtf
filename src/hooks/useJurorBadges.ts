/**
 * useJurorBadges - NIP-58 badge display for jurors.
 *
 * Reads kind-8 badge acceptance events from the BAO Court relay and matches
 * them to a juror by the `d` tag carrying the juror pubkey (the court's
 * badge convention). Each observed event yields one badge name taken from
 * the `a` tag (`<30009:<badge-id>`), falling back to the `name` tag.
 *
 * ## Trust model (security round 1)
 *
 * A kind-8 ACCEPTANCE event is published by the badge holder themselves
 * (NIP-58) — it is NOT a court-issued award. Events are therefore only
 * counted when they are SELF-published (`event.pubkey === jurorPubkey`),
 * so an attacker cannot mint a badge for another juror by publishing a
 * kind-8 with their pubkey in the `d` tag. The residual trust — the juror
 * self-accepting a badge name the court never awarded — is surfaced in the
 * UI as "self-reported" (see JurorDashboard) rather than silently trusted.
 */
import { useEffect, useState } from "react";
import { NRelay1, type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import { BAO_COURT_RELAY } from "@/lib/baoCourtRelays";

/** NIP-58 badge acceptance event kind. */
export const NIP58_BADGE_ACCEPTED_KIND = 8;

/** Display sanity cap for a badge name taken from hostile event tags. */
const MAX_BADGE_NAME_CHARS = 64;

export interface JurorBadge {
  /** Badge id from the `a` tag (`30009:<name>`), or the `name` tag. */
  readonly name: string;
  readonly eventId: string;
  readonly awardedAt: number;
}

export function badgeNameFromEvent(event: NostrEvent): string | null {
  const aTag = event.tags?.find((t) => t[0] === "a")?.[1];
  if (typeof aTag === "string" && aTag.startsWith("30009:")) {
    const name = aTag.slice("30009:".length).split(":")[0];
    if (name) return name.slice(0, MAX_BADGE_NAME_CHARS);
  }
  const nameTag = event.tags?.find((t) => t[0] === "name")?.[1];
  if (typeof nameTag === "string" && nameTag) return nameTag.slice(0, MAX_BADGE_NAME_CHARS);
  return null;
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
          limit: 100,
        };
        const events = await relay.query([filter], { signal: controller.signal });
        const seen = new Set<string>();
        const found: JurorBadge[] = [];
        for (const event of events) {
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          // NIP-58 acceptance is self-published: only count events the
          // juror signed themselves (anti-spoofing; see header trust note).
          if (typeof event.pubkey !== "string" || event.pubkey.toLowerCase() !== juror) {
            continue;
          }
          // Court convention: the `d` tag carries the juror pubkey.
          const dTag = event.tags?.find((t) => t[0] === "d")?.[1];
          if (typeof dTag !== "string" || dTag.toLowerCase() !== juror) continue;
          const name = badgeNameFromEvent(event);
          if (!name) continue;
          found.push({ name, eventId: event.id, awardedAt: event.created_at });
        }
        found.sort((a, b) => b.awardedAt - a.awardedAt);
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
