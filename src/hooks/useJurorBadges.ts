/**
 * useJurorBadges - NIP-58 badge display for jurors.
 *
 * Reads kind-8 badge acceptance events from the BAO Court relay and matches
 * them to a juror by the `d` tag carrying the juror pubkey (the court's
 * badge convention). Each observed event yields one badge name taken from
 * the `a` tag (`<30009:<badge-id>`), falling back to the `name` tag.
 */
import { useEffect, useState } from "react";
import { NRelay1, type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import { BAO_COURT_RELAY } from "@/lib/baoCourtRelays";

/** NIP-58 badge acceptance event kind. */
export const NIP58_BADGE_ACCEPTED_KIND = 8;

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
    if (name) return name;
  }
  const nameTag = event.tags?.find((t) => t[0] === "name")?.[1];
  if (typeof nameTag === "string" && nameTag) return nameTag;
  return null;
}

export function useJurorBadges(jurorPubkey: string | null | undefined): JurorBadge[] {
  const [badges, setBadges] = useState<JurorBadge[]>([]);

  useEffect(() => {
    if (!jurorPubkey) return;
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
          // Court convention: the `d` tag carries the juror pubkey.
          const dTag = event.tags?.find((t) => t[0] === "d")?.[1];
          if (dTag !== jurorPubkey) continue;
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
