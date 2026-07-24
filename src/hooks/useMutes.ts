import { useCallback, useMemo } from "react";

import { channelReadKey } from "@/contexts/ReadStateContext";
import { useAppContext } from "@/hooks/useAppContext";
import { useNotifLevels } from "@/hooks/useNotifLevels";
import { normalizeRelayUrl } from "@/lib/platform";

/**
 * Stable mute key for a community: a normalized relay URL for NIP-29 servers,
 * `c1:${communityId}` / `c2:${communityId}` for Concord — the same stable key
 * scheme the server rail uses (`railOrder` / `railLayout`).
 */
export function communityMuteKey(relayUrlOrRailKey: string): string {
  if (relayUrlOrRailKey.startsWith("c1:") || relayUrlOrRailKey.startsWith("c2:")) {
    return relayUrlOrRailKey;
  }
  return normalizeRelayUrl(relayUrlOrRailKey) ?? relayUrlOrRailKey;
}

/**
 * Stable mute key for a NIP-29 channel: `${relayUrl}::${groupId}` — the same
 * key scheme as the read state, with the relay URL normalized so a mute set
 * from one surface (route param, group list, rail) matches everywhere.
 */
export function channelMuteKey(relayUrl: string, groupId: string): string {
  return channelReadKey(normalizeRelayUrl(relayUrl) ?? relayUrl, groupId);
}

/**
 * Stable mute key for a Concord channel:
 * `c1:${communityId}::${channelIdHex}` / `c2:${communityId}::${channelIdHex}`
 * — the community's rail key plus the channel id, mirroring the NIP-29
 * `${relayUrl}::${groupId}` shape.
 */
export function concordChannelMuteKey(
  protocol: "c1" | "c2",
  communityId: string,
  channelIdHex: string,
): string {
  return `${protocol}:${communityId}::${channelIdHex}`;
}

export interface UseMutesReturn {
  /** Muted community keys (rail keys). */
  mutedCommunities: Set<string>;
  /** Muted channel keys (`${relayUrl}::${groupId}`). */
  mutedChannels: Set<string>;
  /** Whether a community (server / Concord community) is muted. */
  isCommunityMuted: (railKey: string) => boolean;
  /**
   * Whether a NIP-29 channel is muted — either individually or because its
   * whole server is muted.
   */
  isChannelMuted: (relayUrl: string, groupId: string) => boolean;
  /**
   * Whether a Concord channel is muted — either individually or because its
   * whole community is muted.
   */
  isConcordChannelMuted: (
    protocol: "c1" | "c2",
    communityId: string,
    channelIdHex: string,
  ) => boolean;
  /** Toggle a community mute (by rail key). */
  toggleCommunityMute: (railKey: string) => void;
  /** Toggle an individual channel mute. */
  toggleChannelMute: (relayUrl: string, groupId: string) => void;
  /** Toggle an individual Concord channel mute. */
  toggleConcordChannelMute: (
    protocol: "c1" | "c2",
    communityId: string,
    channelIdHex: string,
  ) => void;
}

/**
 * Per-community / per-channel notification mutes.
 *
 * "Muted" is now the `nothing` end of the Discord-style notification levels
 * (see {@link useNotifLevels}): a muted scope silences all delivery paths
 * (foreground, web push, native service) and suppresses its unread badge
 * without leaving — unread mentions still badge, Discord-style. This hook is a
 * thin compatibility facade over `useNotifLevels` so the many existing mute
 * call sites keep working: `is*Muted` reports whether the effective level is
 * `nothing`, and the toggles flip a scope between `nothing` and clearing its
 * override (inherit). Stored in AppConfig and synced across devices.
 */
export function useMutes(): UseMutesReturn {
  const { config } = useAppContext();
  const { getLevel, setLevel } = useNotifLevels();

  const mutedCommunities = useMemo(
    () => new Set(config.mutedCommunities.map(communityMuteKey)),
    [config.mutedCommunities],
  );
  const mutedChannels = useMemo(
    () => new Set(config.mutedChannels),
    [config.mutedChannels],
  );

  // "Muted" means an EXPLICIT `nothing` at the scope or an inherited one from
  // the parent community — deliberately NOT the global-prefs fallback, so
  // turning off a global toggle never silences every badge. This preserves the
  // exact pre-levels badge semantics (channel-mute OR server/community-mute).
  const isCommunityMuted = useCallback(
    (railKey: string) => getLevel(communityMuteKey(railKey)) === "nothing",
    [getLevel],
  );

  const isChannelMuted = useCallback(
    (relayUrl: string, groupId: string) =>
      getLevel(channelMuteKey(relayUrl, groupId)) === "nothing" ||
      getLevel(communityMuteKey(relayUrl)) === "nothing",
    [getLevel],
  );

  const isConcordChannelMuted = useCallback(
    (protocol: "c1" | "c2", communityId: string, channelIdHex: string) =>
      getLevel(concordChannelMuteKey(protocol, communityId, channelIdHex)) === "nothing" ||
      getLevel(`${protocol}:${communityId}`) === "nothing",
    [getLevel],
  );

  const toggleCommunityMute = useCallback(
    (railKey: string) => {
      const key = communityMuteKey(railKey);
      setLevel(key, getLevel(key) === "nothing" ? undefined : "nothing");
    },
    [setLevel, getLevel],
  );

  const toggleChannelMute = useCallback(
    (relayUrl: string, groupId: string) => {
      const key = channelMuteKey(relayUrl, groupId);
      setLevel(key, getLevel(key) === "nothing" ? undefined : "nothing");
    },
    [setLevel, getLevel],
  );

  const toggleConcordChannelMute = useCallback(
    (protocol: "c1" | "c2", communityId: string, channelIdHex: string) => {
      const key = concordChannelMuteKey(protocol, communityId, channelIdHex);
      setLevel(key, getLevel(key) === "nothing" ? undefined : "nothing");
    },
    [setLevel, getLevel],
  );

  return {
    mutedCommunities,
    mutedChannels,
    isCommunityMuted,
    isChannelMuted,
    isConcordChannelMuted,
    toggleCommunityMute,
    toggleChannelMute,
    toggleConcordChannelMute,
  };
}
