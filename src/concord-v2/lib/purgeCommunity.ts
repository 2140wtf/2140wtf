import type { QueryClient } from "@tanstack/react-query";

import { controlGroups } from "@/concord-v2/lib/control";
import {
  bytesToHex,
  channelGroupKey,
  dissolvedGroupKey,
} from "@/concord-v2/lib/derive";
import { guestbookGroups } from "@/concord-v2/lib/guestbook";
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
