/**
 * Where a CORD invite reaches a member (CORD-05 §6).
 *
 * A member advertises where to reach them with a NIP-17 DM relay list
 * (kind 10050), or failing that their NIP-65 read relays (kind 10002). When a
 * member has published neither, there is no per-member rendezvous, so both the
 * sender and the member's own scanner fall back to the STOCK set: the four
 * relays every CORD client ships identically (CORD-05 §3's relay dictionary /
 * flag bit). Send and scan share this resolution so the two sides always meet:
 * a sender broadcasts to `recipient-inbox-or-STOCK`, and the recipient scans
 * `my-inbox-or-STOCK` — the same set, derived from the same published list.
 *
 * The fallback is fallback-ONLY: a member who curated a private inbox is
 * reached there and nowhere else, never also fanned out onto the public stock
 * relays.
 */

import { KIND_DM_RELAYS, parseDmRelays } from "@/hooks/useDmRelayList";
import { STOCK_RELAYS } from "@/concord-v2/lib/invite";
import { capRelays } from "@/concord-v2/lib/types";

import type { NostrEvent, NostrFilter } from "@nostrify/nostrify";

/** The NIP-65 relay-list kind (read/write markers). */
const KIND_RELAY_LIST = 10002;

/** The minimum of a Nostr client this module needs: a pooled query. */
interface NostrQuery {
  query(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]>;
}

/**
 * A member's published inbox relays: their kind-10050 DM relays if any, else
 * their NIP-65 read relays. `[]` means they've CONFIRMED-published neither (the
 * caller falls back to {@link inviteDeliveryRelays}'s stock floor); `null` means
 * the lookup itself FAILED (relays unreachable/timed out) so it's unknown —
 * distinct on purpose, because treating a failed lookup as "no list" would
 * misdeliver a list-having member's invite to the stock set (and never
 * self-heal), and would leak a scanner's own `#p` REQ to the stock relays.
 */
export async function recipientInboxRelays(nostr: NostrQuery, recipient: string): Promise<string[] | null> {
  const events = await nostr
    .query([{ kinds: [KIND_DM_RELAYS, KIND_RELAY_LIST], authors: [recipient], limit: 4 }], {
      signal: AbortSignal.timeout(6000),
    })
    .catch(() => null);
  if (events === null) return null;

  const latestOf = (kind: number) =>
    events.filter((e) => e.kind === kind).sort((a, b) => b.created_at - a.created_at)[0];

  const dm = parseDmRelays(latestOf(KIND_DM_RELAYS));
  if (dm.length > 0) return capRelays(dm);

  // NIP-65 read relays: tags with no marker are read+write.
  const nip65 = latestOf(KIND_RELAY_LIST);
  const reads: string[] = [];
  for (const [name, url, marker] of nip65?.tags ?? []) {
    if (name !== "r" || marker === "write" || !url) continue;
    reads.push(url);
  }
  return capRelays(reads);
}

/**
 * The relays an invite is delivered to / scanned on: the member's published
 * inbox when they have one, else the stock interop set. See the module
 * docstring for why send and scan MUST resolve this identically. Callers must
 * handle a `null` inbox (lookup failed) before calling this — a failed lookup
 * is not "no list". Returns a fresh array so callers can't mutate the shared
 * stock const.
 */
export function inviteDeliveryRelays(inboxRelays: string[]): string[] {
  return inboxRelays.length > 0 ? [...inboxRelays] : [...STOCK_RELAYS];
}
