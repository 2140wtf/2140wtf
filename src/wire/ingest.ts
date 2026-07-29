import { openChatBatch } from "@/concord-v2/lib/chat";
import { KIND_MESSAGE, KIND_REACTION } from "@/concord-v2/lib/kinds";
import type { GroupKey } from "@/concord-v2/lib/derive";
import { notePlaneWrapsSeen, openPlaneWrapsChunked, unseenPlaneWraps } from "@/concord-v2/lib/planeSync";
import { parkPendingWraps, writeOpened, writeRumors } from "@/concord-v2/lib/rumorStore";
import { reactionContentKey } from "@/hooks/useReactions";
import { emitWireScopes } from "@/wire/bus";
import { feedNotifyCandidates, type NotifyCandidate } from "@/wire/notify";

import type { OpenedChat } from "@/concord-v2/lib/chat";
import type { WireSpec } from "@/wire/spec";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import type { NostrEvent } from "@nostrify/nostrify";

/** Gift-wrap kinds (Concord V2 / NIP-59) — never persisted sealed. */
const WRAP_KINDS = new Set([1059, 21059]);
/** NIP-29 group chat message kind (plaintext planes landing in the event store). */
const KIND_GROUP_CHAT = 9;
/** NIP-88 poll kind — a channel-activity message in group timelines. */
const KIND_POLL = 1068;

/** Preview text length cap for a foreground notification body. */
const PREVIEW_MAX = 140;

function preview(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX - 1)}…` : t;
}

/** The minimal store surface the wire writes to (the shared 2140-events store). */
export interface WireEventStore {
  event(event: NostrEvent, opts?: { signal?: AbortSignal }): Promise<void>;
}

export interface WireSinks {
  /** The shared plaintext event store (NIndexedDB). */
  eventStore: Promise<WireEventStore>;
  /** The current spec (decrypt map + scope naming). */
  getSpec: () => WireSpec | undefined;
  /** The logged-in user's pubkey (for mention detection / self-suppression). */
  getSelfPubkey?: () => string | undefined;
}

/** First value of a tag, if any. */
function tagValue(ev: NostrEvent, name: string): string | undefined {
  for (const t of ev.tags) if (t[0] === name && t[1]) return t[1];
  return undefined;
}

/** The bus scope a plaintext event belongs to, if any. */
function scopeOf(ev: NostrEvent): string | undefined {
  const h = tagValue(ev, "h");
  if (h) return `nip29:${h}`;
  return undefined;
}

/**
 * The wire's single ingestion point. EVERY transport funnels through here —
 * the web socket manager and (on a native shell) the background-service
 * bridge — so there is exactly one routing rule:
 *
 *   - Concord V2 wraps whose stream key we hold → decrypt → rumor store.
 *   - V2 wraps we can't open yet (control/invite planes, key not derived yet)
 *     → parked pending store, drained later by whoever holds the key.
 *   - Everything else (plaintext group kinds) → the shared event store.
 *     The store applies NIP-09 deletions itself.
 *
 * After the store write, the affected conversation scopes are announced on the
 * wire bus; hooks re-read the store. Writes are idempotent (stores dedupe by
 * id), so overlapping transports are harmless.
 *
 * PRUNED SCOPE (phase 1): Armada's ingest also routed kind-4 DMs, NIP-17
 * gift-wrap buffering + sender attribution, Concord V1 sealed outers, and
 * Buzz kinds. This client owns those planes elsewhere (DmInboxContext,
 * NIP-104 group chat), so they were removed; the `c2:`/`c2ctl:`/`c2park:`
 * Concord V2 planes are intact.
 *
 * `opts.live` marks events STREAMED live (post-EOSE) as opposed to a round's
 * stored replay (pre-EOSE). Only live arrivals produce notify candidates.
 */
export async function ingestWireEvents(
  sinks: WireSinks,
  events: NostrEvent[],
  opts?: { live?: boolean },
): Promise<void> {
  if (events.length === 0) return;
  const live = opts?.live ?? true;
  const spec = sinks.getSpec();
  const self = sinks.getSelfPubkey?.();
  const scopes = new Set<string>();
  const candidates: NotifyCandidate[] = [];

  // Split wraps from plaintext; group decryptable wraps per channel so the
  // (chunked, memoized) decode runs one batch per channel. Control-plane wraps
  // (a separate author set) are collected per community for a fold wake.
  const wrapsByChannel = new Map<ChannelV2, NostrEvent[]>();
  const ctlWraps: NostrEvent[] = [];
  const toPark: NostrEvent[] = [];
  const plain: NostrEvent[] = [];
  for (const ev of events) {
    if (!ev || typeof ev.id !== "string" || typeof ev.kind !== "number") continue;
    if (WRAP_KINDS.has(ev.kind)) {
      const channel = spec?.v2ByPk.get(ev.pubkey);
      if (channel) {
        const list = wrapsByChannel.get(channel);
        if (list) list.push(ev);
        else wrapsByChannel.set(channel, [ev]);
      } else if (spec?.v2CtlByPk.has(ev.pubkey)) {
        ctlWraps.push(ev);
      } else {
        // A wrap for a stream we hold no key for yet (V2 control/invite plane,
        // or a just-joined channel whose spec hasn't refreshed) — park it.
        toPark.push(ev);
      }
    } else {
      plain.push(ev);
    }
  }

  // V2: decrypt with the owning channel's stream keys → rumor store.
  for (const [channel, wraps] of wrapsByChannel) {
    const opened = await openChatBatch(wraps, channel);
    if (opened.length === 0) continue;
    // writeRumors rings `c2:<id>` itself AFTER the store commit — don't add
    // the scope here: a pre-commit ring makes hooks re-read a store that
    // can't see the message yet (one guaranteed miss per live message).
    writeRumors(opened);
    const communityIdHex = spec?.v2CommunityByChannel.get(channel.idHex);
    if (live) {
      for (const c of v2Candidates(opened, channel, communityIdHex, self)) candidates.push(c);
    }
  }

  // V2 CONTROL: decrypt with the community's control-stream keys → opened-event
  // store, then ring `c2ctl:<idHex>`. useControlEvents2 listens on that scope
  // (even for a non-open community) to re-seed from the store and re-fold — so
  // a freshly-published channel edition surfaces in the sidebar promptly,
  // without waiting for the slow control-plane sweep or a first message.
  if (ctlWraps.length > 0 && spec) {
    const byCommunity = new Map<string, { groups: GroupKey[]; wraps: NostrEvent[] }>();
    for (const ev of ctlWraps) {
      const entry = spec.v2CtlByPk.get(ev.pubkey);
      if (!entry) continue;
      const bucket = byCommunity.get(entry.idHex);
      if (bucket) bucket.wraps.push(ev);
      else byCommunity.set(entry.idHex, { groups: entry.groups, wraps: [ev] });
    }
    for (const [idHex, { groups, wraps }] of byCommunity) {
      // Skip wraps already processed (the persisted plane memo, shared with
      // the sweep): rotated rounds replay recent control wraps every time —
      // without the memo each replay re-paid the full decrypt+verify.
      const unseen = await unseenPlaneWraps(wraps);
      if (unseen.length === 0) continue;
      const opened = await openPlaneWrapsChunked(unseen, groups);
      if (opened.length > 0) {
        await writeOpened(opened);
        scopes.add(`c2ctl:${idHex}`);
      }
      notePlaneWrapsSeen(unseen.map((w) => w.id));
    }
  }
  // Wraps for streams we hold no key for (control plane, invites, or a
  // just-joined channel whose spec hasn't refreshed): park for the plane
  // hooks that do hold the keys. Peek+ack semantics keep this loss-proof.
  // Ring a doorbell naming the wrap's stream address: a hook that DOES hold
  // that stream's key (e.g. the active channel right after a rekey, before
  // the wire spec has refreshed its stream set) can drain the park instead
  // of sitting in dead air until the next poll.
  if (toPark.length > 0) {
    parkPendingWraps(toPark);
    for (const ev of toPark) scopes.add(`c2park:${ev.pubkey}`);
  }

  // Plaintext planes → the shared event store (NIP-09 applied by the store).
  // All writes are submitted BEFORE awaiting: NIndexedDB batches a burst of
  // event() calls into ONE idle-scheduled transaction, but only if none of
  // them is awaited first — a serial `await store.event(ev)` loop resolves
  // each call with that event's own flush, turning an N-event backfill into N
  // idle-window waits and N single-event transactions, and delaying the bus
  // emission below until the last one. See wire/ingestBatching.test.ts.
  if (plain.length > 0) {
    const store = await sinks.eventStore;
    const writes = plain.map((ev) =>
      Promise.resolve()
        .then(() => store.event(ev))
        .catch(() => {
          // Duplicate or rejected — either way the store's state is authoritative.
        })
    );
    for (const ev of plain) {
      const scope = scopeOf(ev);
      if (scope) scopes.add(scope);
      if (live) {
        const cand = plaintextCandidate(ev, self);
        if (cand) candidates.push(cand);
      }
    }
    // Await the shared flush so the bus only rings once the events are
    // durably readable — a doorbell before the commit would send hooks
    // re-reading a store that can't see these events yet.
    await Promise.all(writes);
  }

  if (scopes.size > 0) emitWireScopes(scopes);
  feedNotifyCandidates(candidates);
}

/** Build notify candidates for a batch of decrypted V2 chat rumors. */
function v2Candidates(
  opened: OpenedChat[],
  channel: ChannelV2,
  communityIdHex: string | undefined,
  self: string | undefined,
): NotifyCandidate[] {
  const out: NotifyCandidate[] = [];
  const path = communityIdHex
    ? `/bao/c/${encodeURIComponent(communityIdHex)}/${encodeURIComponent(channel.idHex)}`
    : "";
  for (const r of opened) {
    if (self && r.author === self) continue; // never notify on our own message
    const pTagsMe = Boolean(self) && r.tags.some(([n, v]) => n === "p" && v === self);

    // A reaction (kind 7) notifies ONLY when it p-tags the current user (i.e.
    // someone reacted to YOUR message). The reacted-to author is carried on the
    // encrypted rumor's `p` tag (NIP-25), invisible to the relay. Any other
    // non-message kind (edit/delete) still stays silent.
    if (r.kind === KIND_REACTION) {
      if (!pTagsMe) continue;
      out.push({
        plane: "c2",
        author: r.author,
        createdAt: r.createdAt,
        mention: true, // a reaction to your message is directed at you
        reaction: true,
        reactionEmoji: reactionContentKey(r.content),
        kind: r.kind,
        roomKey: `c2:${channel.idHex}`,
        readKey: channel.idHex,
        path,
        channelIdHex: channel.idHex,
      });
      continue;
    }
    if (r.kind !== KIND_MESSAGE) continue; // edits/deletes don't notify
    out.push({
      plane: "c2",
      author: r.author,
      createdAt: r.createdAt,
      mention: pTagsMe,
      kind: r.kind,
      body: preview(r.content),
      roomKey: `c2:${channel.idHex}`,
      readKey: channel.idHex, // Concord2 read map is keyed by channel id hex
      path,
      channelIdHex: channel.idHex,
    });
  }
  return out;
}

/**
 * Build a notify candidate for a plaintext group event. Returns undefined for
 * events that shouldn't notify (self-authored, non-activity kinds, deletions).
 */
function plaintextCandidate(
  ev: NostrEvent,
  self: string | undefined,
): NotifyCandidate | undefined {
  if (self && ev.pubkey === self) return undefined; // never notify on our own message

  const h = tagValue(ev, "h");
  if (h) {
    if (ev.kind !== KIND_GROUP_CHAT && ev.kind !== KIND_POLL) {
      return undefined;
    }
    // The relay URL isn't on the event; the notifier hook maps groupId → relay
    // (+ route + name) from the user's group list. Leave relayUrl unset here.
    return {
      plane: "nip29",
      author: ev.pubkey,
      createdAt: ev.created_at,
      mention: Boolean(self) && ev.tags.some(([n, v]) => n === "p" && v === self),
      kind: ev.kind,
      body: preview(ev.content),
      roomKey: "", // filled by the hook once the relay URL is known
      readKey: "", // filled by the hook (needs the relay URL)
      path: "",
      groupId: h,
    };
  }

  return undefined;
}
