import { bytesToHex } from "@noble/hashes/utils.js";

import { channelsView } from "@/concord-v2/lib/community";
import type { FoldedControl } from "@/concord-v2/lib/control";
import type { GroupKey } from "@/concord-v2/lib/derive";
import type { CommunityV2 } from "@/concord-v2/lib/types";

/**
 * One stream address of a V2 channel (one per held epoch): the wrap author to
 * filter on and the NIP-44 self-ECDH conversation key that opens its wraps.
 * The stream SECRET key is deliberately NOT shipped to native code — the
 * conversation key decrypts notification payloads. A future native service
 * must implement its own per-community authenticated transport rather than
 * borrowing WebView or user-identity sockets.
 */
export interface Concord2Stream {
  /** Stream address (x-only pubkey hex) — the kind-1059 `authors` filter entry. */
  pk: string;
  /** NIP-44 conversation key (hex) that decrypts this stream's wraps. */
  convKey: string;
  /** Epoch (decimal string) the rumor's `epoch` binding tag must equal. */
  epoch: string;
}

/**
 * A native-notification subscription for one Concord V2 channel: the relays
 * its wraps live on, the per-epoch stream addresses + decrypt keys, and the
 * display names / ids for the notification and its deep link
 * (/bao/c/<communityId>/<channelId>). The native service filters
 * `{kinds:[1059], authors:[…pk]}` and opens wrap → seal → rumor with the
 * supplied conversation key to show "<sender>: <preview>".
 */
export interface Concord2Sub {
  relays: string[];
  /** Community id (hex) for the deep link. */
  communityId: string;
  communityName: string;
  /** Channel id (hex): deep-link segment + the rumor's `channel` binding tag. */
  channelId: string;
  channelName: string;
  /** Every held epoch's stream (newest first). */
  streams: Concord2Stream[];
}

/**
 * Build the per-channel V2 notification subscriptions for one community from
 * its rehydrated runtime shape + its (possibly cached) Control fold. Also
 * returns the channels' stream GroupKeys for a future native implementation to
 * place into per-community sessions. They must never be registered on a shared
 * WebView/user socket.
 */
export function buildConcord2Subs(
  community: CommunityV2,
  folded: FoldedControl | undefined,
): { subs: Concord2Sub[]; streamKeys: GroupKey[] } {
  const subs: Concord2Sub[] = [];
  const streamKeys: GroupKey[] = [];
  if (community.relays.length === 0) return { subs, streamKeys };

  const communityName = folded?.metadata?.name || community.name || "Community";
  for (const channel of channelsView(community, folded)) {
    if (channel.streams.length === 0) continue;
    streamKeys.push(...channel.streams.map((s) => s.group));
    subs.push({
      relays: community.relays,
      communityId: community.idHex,
      communityName,
      channelId: channel.idHex,
      channelName: channel.name,
      streams: channel.streams.map((s) => ({
        pk: s.group.pk,
        convKey: bytesToHex(s.group.convKey),
        epoch: s.epoch.toString(),
      })),
    });
  }
  // Deterministic order (ids, not display names) so a mere refetch/rename
  // doesn't churn the native config and tear down live connections.
  subs.sort((a, b) =>
    a.communityId !== b.communityId
      ? a.communityId < b.communityId ? -1 : 1
      : a.channelId < b.channelId ? -1 : 1,
  );
  return { subs, streamKeys };
}
