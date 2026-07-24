import { normalizeRelayUrl } from "@/lib/platform";
import { KIND_WRAP } from "@/concord-v2/lib/kinds";

import type { GroupKey } from "@/concord-v2/lib/derive";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import type { NostrFilter } from "@nostrify/nostrify";

/**
 * NIP-59 gift-wrap backdate window (2 days). Ported from Armada's
 * `lib/nip17/protocol.ts`; the wire's round-stamping rewinds wrap inbox
 * filters by it. Kept as a local constant because this client's own NIP-17
 * stack (`src/lib/nip17.ts`) is a separate, untouched plane.
 */
export const MAX_WRAP_BACKDATE_SECS = 2 * 24 * 60 * 60;

/** NIP-59 gift-wrap kind — carries a NIP-17 (kind-14/15) private DM. */
const KIND_GIFT_WRAP = 1059;

/** Slack added behind the NIP-59 backdate window (clock skew, borderline wraps). */
const WRAP_SINCE_SLACK_SECS = 3600;
/** Stored-replay cap for the DM gift-wrap filter on each fresh REQ round. */
const DM_WRAP_REPLAY_LIMIT = 100;

/**
 * Whether a filter is a NIP-17 DM gift-wrap inbox filter
 * (`{kinds:[1059], "#p":[me]}`). Concord V2 wrap filters share the kind but
 * are `authors`-scoped (stream addresses) and carry no `#p`. This client
 * runs its own NIP-17 DM plane (DmInboxContext), so the wire never BUILDS
 * this filter shape — the check stays so `stampRoundSince` remains correct
 * for any future wrap inbox filter.
 */
function isDmWrapInboxFilter(f: NostrFilter): boolean {
  return !f.authors && f.kinds?.length === 1 && f.kinds[0] === KIND_GIFT_WRAP && Boolean(f["#p"]?.length);
}

/**
 * Stamp a round's filters with their resume `since`.
 *
 * Every filter gets the cursor-derived `since` — EXCEPT a NIP-17 gift-wrap
 * inbox filter. A gift wrap's `created_at` is backdated up to 2 days into the
 * past (NIP-59 `tweakedPast`), and relays apply `since` to LIVE streamed
 * events too, so a cursor-derived `since` (≈ now − 60s) filters out virtually
 * every live wrap. The wrap filter's `since` therefore rewinds the full
 * backdate window (+ slack) behind `now`, and takes the cursor `since` when
 * it reaches even deeper; `limit` bounds that replay (newest-first).
 */
export function stampRoundSince(filters: NostrFilter[], since: number, now: number): NostrFilter[] {
  const wrapSince = Math.min(since, now - MAX_WRAP_BACKDATE_SECS - WRAP_SINCE_SLACK_SECS);
  return filters.map((f) =>
    isDmWrapInboxFilter(f) ? { ...f, since: wrapSince, limit: DM_WRAP_REPLAY_LIMIT } : { ...f, since },
  );
}

/**
 * Everything the ₿AO chat wire needs listened-to, as plain data.
 *
 * PRUNED SCOPE (phase 1): Armada's wire also carried NIP-29 groups, Buzz
 * kinds, kind-4 DMs, NIP-17 gift-wrap attribution, and Concord V1 channels.
 * This client already has its own planes for all of those (DmInboxContext /
 * NIP-104 group chat / the general relay pool), so the wire here ONLY covers
 * the Concord V2 ingest planes: chat wraps, control wraps, and the pending
 * (parked) store.
 */
export interface WireInputs {
  /** Concord V2 channels (each carries its stream GroupKeys for decrypt). */
  concord2: Array<{ relays: string[]; channel: ChannelV2; communityIdHex: string }>;
  /**
   * Concord V2 CONTROL planes (each carries its control-stream GroupKeys). A
   * standing subscription to these authors lands new control editions —
   * channel creations, roster/metadata changes — LIVE for every community,
   * not only the one you have open.
   */
  concord2Control?: Array<{ relays: string[]; idHex: string; groups: GroupKey[] }>;
}

/** One relay's standing subscription. */
export interface WireSub {
  /** Normalized relay URL. */
  relay: string;
  /** Filters to hold open (the manager stamps `since`). */
  filters: NostrFilter[];
}

export interface WireSpec {
  subs: WireSub[];
  /** V2 stream address (wrap author) → owning channel, for decrypt + scope. */
  v2ByPk: Map<string, ChannelV2>;
  /** V2 channel id hex → its owning community id hex (for notification routing). */
  v2CommunityByChannel: Map<string, string>;
  /** V2 CONTROL stream address (wrap author) → its community, for decrypt + fold wake. */
  v2CtlByPk: Map<string, { idHex: string; groups: GroupKey[] }>;
  /** Deterministic signature of `subs` for cheap diffing/resubscribe. */
  sig: string;
}

/**
 * Build the wire's per-relay subscription spec.
 *
 * Concord V2 is relay-per-community: each community relay gets one
 * `authors`-scoped kind-1059 filter covering the channel streams it hosts
 * (plus a second for the control streams). NIP-42 AUTH for the stream keys
 * is handled by the stream-auth registry grafted into the app's
 * NostrProvider (see concord-v2/lib/streamAuth.ts), which matters on relays
 * that gate kind-1059 REQs by `authors`.
 */
export function buildWireSpec(inputs: WireInputs): WireSpec {
  const byRelay = new Map<string, NostrFilter[]>();
  const add = (url: string, filter: NostrFilter) => {
    const relay = normalizeRelayUrl(url);
    if (!relay) return;
    const list = byRelay.get(relay);
    if (list) list.push(filter);
    else byRelay.set(relay, [filter]);
  };

  // ── Concord V2: merged wrap-author filter per community relay ────────────
  const v2ByPk = new Map<string, ChannelV2>();
  const v2CommunityByChannel = new Map<string, string>();
  const pksByRelay = new Map<string, Set<string>>();
  for (const { relays, channel, communityIdHex } of inputs.concord2) {
    for (const s of channel.streams) v2ByPk.set(s.group.pk, channel);
    v2CommunityByChannel.set(channel.idHex, communityIdHex);
    for (const url of relays) {
      const relay = normalizeRelayUrl(url);
      if (!relay) continue;
      let set = pksByRelay.get(relay);
      if (!set) pksByRelay.set(relay, (set = new Set()));
      for (const s of channel.streams) set.add(s.group.pk);
    }
  }
  for (const [relay, pks] of pksByRelay) {
    add(relay, { kinds: [KIND_WRAP], authors: [...pks].sort() });
  }

  // ── Concord V2 CONTROL: merged control-author filter per community relay ──
  // Kept SEPARATE from the chat-wrap map above: control wraps decode with the
  // control-stream keys (not any channel's) and wake the fold rather than a
  // chat timeline (see ingest.ts).
  const v2CtlByPk = new Map<string, { idHex: string; groups: GroupKey[] }>();
  const ctlPksByRelay = new Map<string, Set<string>>();
  for (const { relays, idHex, groups } of inputs.concord2Control ?? []) {
    for (const g of groups) v2CtlByPk.set(g.pk, { idHex, groups });
    for (const url of relays) {
      const relay = normalizeRelayUrl(url);
      if (!relay) continue;
      let set = ctlPksByRelay.get(relay);
      if (!set) ctlPksByRelay.set(relay, (set = new Set()));
      for (const g of groups) set.add(g.pk);
    }
  }
  for (const [relay, pks] of ctlPksByRelay) {
    add(relay, { kinds: [KIND_WRAP], authors: [...pks].sort() });
  }

  const subs: WireSub[] = [...byRelay.entries()]
    .map(([relay, filters]) => ({ relay, filters }))
    .sort((a, b) => (a.relay < b.relay ? -1 : 1));

  return { subs, v2ByPk, v2CommunityByChannel, v2CtlByPk, sig: JSON.stringify(subs) };
}
