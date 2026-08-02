import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryRumorsByChannel } from "@/concord-v2/lib/rumorStore";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useWireScopes } from "@/wire/useWireScopes";

import type { OpenedChat } from "@/concord-v2/lib/chat";
import type { ChannelV2 } from "@/concord-v2/lib/types";

/**
 * How many newest rumors to read per channel for the community-wide derived
 * views (unread badges, threads). Sized for thread reconstruction (the most
 * demanding consumer); unread only needs the newest.
 */
const PER_CHANNEL = 200;

/**
 * The single shared read of a Concord V2 community's cached rumors, grouped by
 * channel. The community-wide derived views that only need each channel's
 * newest window — unread badges and the Threads tab — read from THIS one query
 * rather than each scanning the store independently. (Mentions deliberately do
 * NOT: a mention older than a busy channel's window must still surface, so
 * they keep their own index-backed `#p` filter — see `useConcord2Mentions`.)
 *
 * Why this exists: those views used to each loop every channel with its own
 * `queryChannelRumors`, so a community with N channels issued a transaction
 * per channel per view, all contending on the single connection with the
 * active channel's own timeline read — the channel-switch stall. Here it is
 * one `query()` (one transaction, one filter per channel) shared across
 * consumers, re-run only when the wire actually ingests a rumor for a watched
 * channel.
 *
 * The result is keyed by the channel SET (not any read-state), so opening a
 * channel — which advances read state but changes no rumors — never re-reads
 * the store; the read-dependent bits (is-unread, has-new) are derived downstream
 * as pure computation.
 */
export function useCommunityRumors(channels: ChannelV2[]): {
  byChannel: Map<string, OpenedChat[]>;
  isLoading: boolean;
} {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  // Include the authorized stream set: channel ids survive rekeys, while the
  // plaintext this account may read does not.
  const channelSig = channels
    .map((channel) => `${channel.idHex}:${channel.streams.map((stream) => stream.group.pk).sort().join(".")}`)
    .sort()
    .join(",");
  const authorizedChannels = useMemo(
    () => channels.map((channel) => ({
      idHex: channel.idHex,
      streamPks: channel.streams.map((stream) => stream.group.pk),
    })),
    [channelSig], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const idSet = useMemo(() => new Set(authorizedChannels.map((channel) => channel.idHex)), [authorizedChannels]);

  const queryKey = useMemo(
    () => ["concord2-community-rumors", user?.pubkey ?? null, channelSig] as const,
    [user?.pubkey, channelSig],
  );

  const { data, isLoading } = useQuery<Map<string, OpenedChat[]>>({
    queryKey,
    queryFn: ({ signal }) => queryRumorsByChannel(authorizedChannels, { perChannel: PER_CHANNEL, signal }),
    enabled: Boolean(user && authorizedChannels.length > 0),
    // A cheap single transaction; the wire bus below is the live path, this is
    // just a backstop for a missed announcement.
    refetchInterval: 30_000,
    staleTime: 0,
  });

  // Re-read when the wire ingests a rumor for a watched channel. The bus
  // already coalesces a burst of writes into one flush, so this fires at most
  // once per burst.
  useWireScopes((scopes) => {
    for (const s of scopes) {
      if (s.startsWith("c2:") && idSet.has(s.slice(3))) {
        void queryClient.invalidateQueries({ queryKey });
        return;
      }
    }
  });

  return { byChannel: data ?? EMPTY, isLoading };
}

const EMPTY: Map<string, OpenedChat[]> = new Map();
