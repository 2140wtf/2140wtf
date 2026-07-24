import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCommunityRumors } from "@/concord-v2/hooks/useCommunityRumors";
import { KIND_MESSAGE } from "@/concord-v2/lib/kinds";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import {
  loadConcord2ReadState,
  markConcord2Read,
  type Concord2ReadMap,
} from "@/concord-v2/lib/readState2";

/** Per-channel unread summary (mirrors NIP-29's `GroupUnread`). */
export interface Concord2Unread {
  /** Newest unread message's created_at, unix SECONDS. */
  latest: number;
  /** Any unread message p-tags the current user. */
  mention: boolean;
}

/**
 * The TanStack Query key for a user's persisted V2 read-state map. Shared
 * across every `useConcord2Unread` call site (the rail icon AND the open
 * community page) so a `markRead` in one instantly updates the other.
 */
const readMapKey = (pubkey: string | undefined) => ["concord2-read-map", pubkey] as const;

/**
 * Per-channel unread state for a Concord V2 community, derived PURELY from the
 * shared community rumor scan ({@link useCommunityRumors}) and the persisted
 * read map — no store access of its own. A channel is unread when its newest
 * non-self message is newer than the persisted last-read timestamp.
 *
 * Because the derivation is pure (no IndexedDB), a `markRead` recomputes every
 * mounted instance (rail + page) instantly, and opening a channel never
 * re-reads the store.
 *
 * Returns `byChannel[channelIdHex]` (present ⇒ unread), a `markRead(channel,
 * ts)` to advance a channel's read stamp, and a `getLastRead` accessor.
 */
export function useConcord2Unread(channels: ChannelV2[]): {
  byChannel: Record<string, Concord2Unread>;
  markRead: (channelIdHex: string, timestamp: number) => void;
  getLastRead: (channelIdHex: string) => number;
} {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const queryClient = useQueryClient();

  const channelSig = channels.map((c) => c.idHex).join(",");
  const channelIds = useMemo(() => channels.map((c) => c.idHex), [channelSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // The persisted read map, shared across mounts via the query cache —
  // `markRead` updates it with `setQueryData`, notifying all subscribers.
  const { data: readMap = {} } = useQuery<Concord2ReadMap>({
    queryKey: readMapKey(pubkey),
    queryFn: () => loadConcord2ReadState(pubkey!),
    enabled: !!pubkey,
    staleTime: Infinity,
  });

  // The one shared community read (see useCommunityRumors).
  const { byChannel: rumorsByChannel } = useCommunityRumors(channelIds);

  const byChannel = useMemo<Record<string, Concord2Unread>>(() => {
    const next: Record<string, Concord2Unread> = {};
    for (const [idHex, rumors] of rumorsByChannel) {
      const lastRead = readMap[idHex] ?? 0;
      let latest = 0;
      let latestMention = 0;
      for (const r of rumors) {
        if (r.kind !== KIND_MESSAGE) continue;
        if (r.author === pubkey) continue; // never unread from self
        if (r.createdAt > latest) latest = r.createdAt;
        if (r.createdAt > latestMention && r.tags.some(([n, v]) => n === "p" && v === pubkey)) {
          latestMention = r.createdAt;
        }
      }
      if (latest > lastRead) next[idHex] = { latest, mention: latestMention > lastRead };
    }
    return next;
  }, [rumorsByChannel, readMap, pubkey]);

  const markRead = useCallback(
    (channelIdHex: string, timestamp: number) => {
      if (!pubkey || timestamp <= 0) return;
      // Optimistically advance the shared read map so every mounted instance
      // (rail + page) re-derives its unread state immediately, then persist.
      queryClient.setQueryData<Concord2ReadMap>(readMapKey(pubkey), (prev = {}) =>
        (prev[channelIdHex] ?? 0) >= timestamp ? prev : { ...prev, [channelIdHex]: timestamp },
      );
      void markConcord2Read(pubkey, channelIdHex, timestamp).then((map) => {
        queryClient.setQueryData(readMapKey(pubkey), map);
      });
    },
    [pubkey, queryClient],
  );

  const getLastRead = useCallback((channelIdHex: string) => readMap[channelIdHex] ?? 0, [readMap]);

  return useMemo(() => ({ byChannel, markRead, getLastRead }), [byChannel, markRead, getLastRead]);
}
