import type { QueryClient } from "@tanstack/react-query";
import { finalizeEvent } from "nostr-tools/pure";

import { controlGroups } from "@/concord-v2/lib/control";
import {
  bytesToHex,
  channelGroupKey,
  dissolvedGroupKey,
} from "@/concord-v2/lib/derive";
import { guestbookGroups } from "@/concord-v2/lib/guestbook";
import type { GroupKey } from "@/concord-v2/lib/derive";
import { queryStoredInvites, inviteInbox } from "@/concord-v2/lib/inviteInbox";
import { forgetPlaneWraps } from "@/concord-v2/lib/planeSync";
import { clearReadCutPending } from "@/concord-v2/lib/readCutPending";
import {
  ackPendingWraps,
  peekPendingWraps,
  queryByStreams,
  rumorStore,
} from "@/concord-v2/lib/rumorStore";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { deleteFoldedWhere } from "@/lib/foldedCache";
import { mirrorGroups } from "@/concord-v2/lib/relayMirror";
import type { NostrEvent, NostrFilter } from "@nostrify/nostrify";
import { KIND_INVITE_BUNDLE, KIND_STREAM_SPONSORSHIP, KIND_WRAP } from "@/concord-v2/lib/kinds";

interface RemotePurgeRelay {
  relay(url: string): {
    query(filters: NostrFilter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]>;
    event(event: NostrEvent, opts?: { signal?: AbortSignal }): Promise<void>;
  };
}

export interface RemotePurgeReport {
  found: number;
  requested: number;
  accepted: number;
  failed: number;
  remaining: number;
  unverified: number;
  relays: Array<{
    url: string;
    found: number;
    requested: number;
    accepted: number;
    remaining: number;
    verified: boolean;
  }>;
}

const PURGE_QUERY_LIMIT = 5000;
const PURGE_AUTHOR_CHUNK = 100;
const PURGE_TAG_CHUNK = 100;

function addressableCoordinate(event: NostrEvent): string | undefined {
  if (event.kind < 30_000 || event.kind >= 40_000) return undefined;
  const d = event.tags.find((tag) => tag[0] === "d")?.[1];
  return d === undefined ? undefined : `${event.kind}:${event.pubkey}:${d}`;
}

/** NIP-09 uses `a` for addressable events so every stored revision is covered. */
export function purgeDeletionTags(events: NostrEvent[]): string[][] {
  return events.flatMap((event) => {
    const coordinate = addressableCoordinate(event);
    return [coordinate ? ["a", coordinate] : ["e", event.id], ["k", String(event.kind)]];
  });
}

/** The minimal signer surface for a caller-signed purge (matches NUser's signer). */
export interface PurgeCallerSigner {
  signEvent(event: { kind: number; content: string; tags: string[][]; created_at: number }): Promise<NostrEvent>;
}

/**
 * Request NIP-09 deletion of all durable BAO events authored by keys held by
 * the founder. Relays are independent and may decline deletion; the report
 * deliberately exposes that best-effort boundary to the caller.
 *
 * With `callerSigner`, one extra kind-5 per batch is signed by the CALLER's
 * own key in addition to the per-author signatures. This is fully neutral:
 * standard NIP-09 relays apply it to the caller's own events only (usually
 * none), while a relay with an operator-deletion policy — whose operator
 * list lives in the RELAY's configuration, never in this repo — may honor it
 * community-wide.
 */
export async function purgeCommunityRemote(
  nostr: RemotePurgeRelay,
  community: CommunityV2,
  signerKeys: ReadonlyMap<string, Uint8Array>,
  // Relays beyond the community's homes that ever held a bundle copy (each
  // live link's own bootstrap hints — consented interop fallback copies).
  relayHints: string[] = [],
  callerSigner?: PurgeCallerSigner,
  // Channel stream groups from channelsView(community, folded) — mirrorGroups
  // covers control/guestbook/rekey planes but NOT chat channels, so without
  // these every chat message survives the purge on the relay.
  channelGroups: GroupKey[] = [],
  // Authenticated Concord reader for stream wraps. Some community relays
  // return an empty result to unauthenticated queries instead of rejecting
  // them, which would make purge verification falsely report zero copies.
  authenticatedNostr?: RemotePurgeRelay,
): Promise<RemotePurgeReport> {
  const keys = new Map<string, Uint8Array>();
  for (const group of mirrorGroups(community)) keys.set(group.pk, group.sk);
  for (const group of channelGroups) keys.set(group.pk, group.sk);
  for (const [pubkey, sk] of signerKeys) keys.set(pubkey, sk);
  const streamAuthors = [...new Set([
    ...mirrorGroups(community).map((group) => group.pk),
    ...channelGroups.map((group) => group.pk),
  ])];
  const inviteAuthors = [...signerKeys.keys()];
  const relays = [...new Set([...community.relays, ...relayHints])];
  const linkSponsorTags = [...signerKeys.keys()].map((pubkey) => `link:${pubkey}`);
  const perRelay = await Promise.all(relays.map(async (url) => {
    const queryTargets = async (): Promise<{ events: Map<string, NostrEvent>; complete: boolean }> => {
      const targets = new Map<string, NostrEvent>();
      let complete = true;
      const streamReader = authenticatedNostr ?? nostr;
      for (let i = 0; i < streamAuthors.length; i += PURGE_AUTHOR_CHUNK) {
        const chunk = streamAuthors.slice(i, i + PURGE_AUTHOR_CHUNK);
        try {
          const found = await streamReader.relay(url).query(
            [{ kinds: [KIND_WRAP], authors: chunk, limit: PURGE_QUERY_LIMIT }],
            { signal: AbortSignal.timeout(15_000) },
          );
          for (const event of found) targets.set(event.id, event);
        } catch {
          complete = false;
        }
      }
      // Invite bundles are public addressable events signed by per-link keys,
      // not Concord stream events. Query them through the normal relay client
      // so the stream session's least-authority check does not reject them.
      for (let i = 0; i < inviteAuthors.length; i += PURGE_AUTHOR_CHUNK) {
        const chunk = inviteAuthors.slice(i, i + PURGE_AUTHOR_CHUNK);
        try {
          const found = await nostr.relay(url).query(
            [{ kinds: [KIND_INVITE_BUNDLE], authors: chunk, limit: PURGE_QUERY_LIMIT }],
            { signal: AbortSignal.timeout(15_000) },
          );
          for (const event of found) targets.set(event.id, event);
        } catch {
          complete = false;
        }
      }
      if (callerSigner) {
        try {
          const sponsorships = await nostr.relay(url).query(
            [{
              kinds: [KIND_STREAM_SPONSORSHIP],
              authors: [community.owner],
              "#d": [community.idHex, ...linkSponsorTags],
              limit: PURGE_QUERY_LIMIT,
            }],
            { signal: AbortSignal.timeout(15_000) },
          );
          for (const event of sponsorships) targets.set(event.id, event);
        } catch {
          complete = false;
        }
      }
      return { events: targets, complete };
    };

    const before = await queryTargets();
    const events = before.events;
    const byAuthor = new Map<string, NostrEvent[]>();
    for (const event of events.values()) {
      const list = byAuthor.get(event.pubkey) ?? [];
      list.push(event);
      byAuthor.set(event.pubkey, list);
    }
    let requested = 0;
    let accepted = 0;
    const sendDeletion = async (deletion: NostrEvent): Promise<void> => {
      requested++;
      try {
        await nostr.relay(url).event(deletion, { signal: AbortSignal.timeout(15_000) });
        accepted++;
      } catch {
        // The relay may reject NIP-09 or the request may time out.
      }
    };
    // Per-author deletions first: signed with each stream's own key, honored
    // by every standard NIP-09 relay.
    for (const [pubkey, targets] of byAuthor) {
      const sk = keys.get(pubkey);
      if (!sk) continue;
      for (let i = 0; i < targets.length; i += PURGE_TAG_CHUNK) {
        const batch = targets.slice(i, i + PURGE_TAG_CHUNK);
        await sendDeletion(finalizeEvent({
          kind: 5,
          content: "",
          tags: purgeDeletionTags(batch),
          created_at: Math.floor(Date.now() / 1000),
        }, sk));
      }
    }
    // PLUS one caller-signed batch covering every found event: a no-op on
    // standard relays (the caller authored none of these), community-wide on
    // a relay with an operator-deletion policy.
    if (callerSigner) {
      const targets = [...events.values()];
      for (let i = 0; i < targets.length; i += PURGE_TAG_CHUNK) {
        const batch = targets.slice(i, i + PURGE_TAG_CHUNK);
        await sendDeletion(await callerSigner.signEvent({
          kind: 5,
          content: "",
          tags: purgeDeletionTags(batch),
          created_at: Math.floor(Date.now() / 1000),
        }));
      }
    }
    const after = accepted > 0 ? await queryTargets() : before;
    const remaining = after.events.size;
    return {
      url,
      found: events.size,
      requested,
      accepted,
      remaining,
      verified: before.complete && after.complete,
    };
  }));
  const totals = perRelay.reduce(
    (report, current) => ({
      found: report.found + current.found,
      requested: report.requested + current.requested,
      accepted: report.accepted + current.accepted,
      failed: report.failed + current.requested - current.accepted,
      remaining: report.remaining + current.remaining,
      unverified: report.unverified + (current.verified ? 0 : 1),
    }),
    { found: 0, requested: 0, accepted: 0, failed: 0, remaining: 0, unverified: 0 },
  );
  return { ...totals, relays: perRelay };
}

/**
 * Per-community local purge (P1-5 of the privacy audit): wipe ONE community's
 * decrypted-at-rest material from this device while KEEPING the membership
 * itself — the community list entry (the keys) is untouched, so the community
 * stays on the rail and re-syncs from its relays on next open. This is the
 * manual, explicit counterpart of the final-logout scorched-earth purge
 * ({@link import("@/lib/purgeConcordStorage").purgeConcordStorage}); nothing
 * here runs on a timer, because an agent or member that loses its local state
 * unexpectedly is functionally ejected.
 *
 * What is wiped:
 *
 * - Opened-event store: every decrypted rumor on the community's streams
 *   (control, guestbook, dissolved, and all channel streams across held
 *   epochs) plus any chat rumor tagged to one of its channels (covers epochs
 *   whose stream keys have rotated away and can no longer be enumerated).
 * - Pending-wrap store: raw wraps parked for those streams.
 * - Folded KV cache: the persisted control-fold snapshot, per-channel sync
 *   cursors, and mention/read stamps scoped to the community or its channels
 *   (keys carry the community or channel id — matched by substring).
 * - Invite inbox: decrypted direct invites naming the community.
 * - localStorage: this account's read-cut moderation intent for the community.
 * - TanStack Query memory: every cached query keyed on the community id.
 *
 * What is deliberately NOT wiped: the community list entry (leaving is a
 * separate, explicit act), the wire's per-relay cursors (shared across
 * communities), and the content-addressed decrypted-image cache (not
 * community-scoped).
 */
export async function purgeCommunityLocalData(
  community: CommunityV2,
  opts: { userPubkey?: string; queryClient?: QueryClient } = {},
): Promise<void> {
  const idHex = community.idHex;

  // Every stream address the community has ever published on, across held
  // epochs: control, guestbook, the dissolved grave, public channel streams
  // (root-derived), and private channel streams (channel-key-derived).
  const streamPks = new Set<string>();
  for (const group of controlGroups(community)) streamPks.add(group.pk);
  for (const group of guestbookGroups(community)) streamPks.add(group.pk);
  streamPks.add(dissolvedGroupKey(community.id).pk);
  for (const root of community.heldRoots) {
    streamPks.add(channelGroupKey(root.key, community.id, root.epoch).pk);
  }
  const channelIdHexes: string[] = [];
  for (const ch of community.privateChannels) {
    channelIdHexes.push(bytesToHex(ch.id));
    streamPks.add(channelGroupKey(ch.key, ch.id, ch.epoch).pk);
  }
  const streams = [...streamPks];

  // 1. Decrypted rumors (opened-event store), by stream AND by channel tag.
  //    FIRST collect their wrap ids and forget them in the plane-sweep memo:
  //    the memo's whole contract is "received ⇒ durably stored", so deleting
  //    the store without forgetting the memo would suppress the re-fetch as
  //    "already processed" and the community would never re-sync.
  try {
    const doomed = await queryByStreams(streams);
    const wrapIds = new Set(doomed.map((event) => event.wrapId));
    if (channelIdHexes.length > 0) {
      // Rotated-away channel streams can't be enumerated by key anymore, so
      // the channel-tag delete below may catch wraps the stream query missed.
      const byChannel = await rumorStore()
        .query([{ "#channel": channelIdHexes } as Parameters<ReturnType<typeof rumorStore>["query"]>[0][number]])
        .catch(() => [] as Awaited<ReturnType<ReturnType<typeof rumorStore>["query"]>>);
      for (const ev of byChannel) {
        const wrapId = ev.tags.find((t) => t[0] === "wrap")?.[1];
        if (wrapId) wrapIds.add(wrapId);
      }
    }
    await forgetPlaneWraps([...wrapIds]);
  } catch {
    // Best-effort — the sweep's complete-scope pager still re-asks every round.
  }
  const filters: Array<Record<string, unknown>> = [{ "#stream": streams }];
  if (channelIdHexes.length > 0) filters.push({ "#channel": channelIdHexes });
  await rumorStore()
    .remove(filters as Parameters<ReturnType<typeof rumorStore>["remove"]>[0])
    .catch(() => undefined);

  // 2. Raw wraps parked for later decryption.
  try {
    const parked = await peekPendingWraps(streams);
    ackPendingWraps(parked.map((wrap) => wrap.id));
  } catch {
    // Best-effort.
  }

  // 3. Folded KV cache: fold snapshot, stream cursors, mention/read stamps —
  //    every key that names the community or one of its channels.
  const scopes = [idHex, ...channelIdHexes];
  await deleteFoldedWhere((key) => scopes.some((scope) => key.includes(scope)));

  // 4. Decrypted direct invites naming this community.
  try {
    const invites = await queryStoredInvites();
    const doomed = invites
      .filter((invite) => JSON.stringify(invite.rumor).includes(idHex))
      .map((invite) => invite.wrapId);
    if (doomed.length > 0) await inviteInbox().remove([{ ids: doomed }]).catch(() => undefined);
  } catch {
    // Best-effort.
  }

  // 5. This account's durable read-cut intent (moderation bookkeeping).
  if (opts.userPubkey) clearReadCutPending(opts.userPubkey, idHex);

  // 6. TanStack Query memory for the community (folds, channels, guestbook,
  //    unread rollups — all keyed on the community id).
  opts.queryClient?.removeQueries({
    predicate: (query) => JSON.stringify(query.queryKey).includes(idHex),
  });
}
