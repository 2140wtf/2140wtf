import { useCallback, useMemo } from "react";

import { channelReadKey } from "@/contexts/ReadStateContext";
import { useAppContext } from "@/hooks/useAppContext";
import { DEFAULT_PUSH_PREFS, type PushPrefs } from "@/hooks/usePushNotifications";
import { normalizeRelayUrl } from "@/lib/platform";

/**
 * Per-conversation notification levels — the Discord model.
 *
 * Every conversation (community, channel, or DM) can be set to one of three
 * levels; a conversation with no explicit level INHERITS from a broader scope:
 *
 *   all       → notify on every message
 *   mentions  → notify only on @-mentions (and DMs, always directed at you)
 *   nothing   → silence completely, mentions included
 *
 * Resolution cascade for a channel:
 *   1. the channel's own level, else
 *   2. its community's level, else
 *   3. the account-global per-type prefs (`PushPrefs`): `allGroupMessages`
 *      on ⇒ `all`, else `mentions` on ⇒ `mentions`, else `nothing`.
 *
 * The same three levels apply to a DM (keyed by peer pubkey), where `mentions`
 * is equivalent to `all` (every DM is directed at you) and the global fallback
 * is the `directMessages` pref.
 *
 * Stored in `AppConfig.notifLevels`, keyed by the SAME stable scope keys the
 * mute sets used, and synced across devices via the encrypted settings event.
 * This supersedes the boolean mute (`nothing` == the old mute), and the legacy
 * `mutedCommunities`/`mutedChannels` entries are read here as level `nothing`
 * so an older client's mutes carry forward without a migration step.
 */

export type NotifLevel = "all" | "mentions" | "nothing";

// ── Stable scope keys (identical scheme to useMutes) ─────────────────────────

/** Community scope key: normalized relay URL (NIP-29) or `c1:`/`c2:` rail key. */
export function communityScopeKey(relayUrlOrRailKey: string): string {
  if (relayUrlOrRailKey.startsWith("c1:") || relayUrlOrRailKey.startsWith("c2:")) {
    return relayUrlOrRailKey;
  }
  return normalizeRelayUrl(relayUrlOrRailKey) ?? relayUrlOrRailKey;
}

/** NIP-29 channel scope key: `${relayUrl}::${groupId}` (relay normalized). */
export function channelScopeKey(relayUrl: string, groupId: string): string {
  return channelReadKey(normalizeRelayUrl(relayUrl) ?? relayUrl, groupId);
}

/** Concord channel scope key: `c1:`/`c2:${communityId}::${channelIdHex}`. */
export function concordChannelScopeKey(
  protocol: "c1" | "c2",
  communityId: string,
  channelIdHex: string,
): string {
  return `${protocol}:${communityId}::${channelIdHex}`;
}

/** DM scope key: `dm:${pubkey}`. */
export function dmScopeKey(pubkey: string): string {
  return `dm:${pubkey}`;
}

/** Read the current global per-type prefs (shared with push/native/foreground). */
function loadPrefs(): PushPrefs {
  try {
    const raw = localStorage.getItem("armada:push-prefs");
    if (raw) return { ...DEFAULT_PUSH_PREFS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_PUSH_PREFS };
}

/** The global fallback level for channel-like scopes, from the per-type prefs. */
function globalChannelLevel(prefs: PushPrefs): NotifLevel {
  if (prefs.allGroupMessages) return "all";
  if (prefs.mentions) return "mentions";
  return "nothing";
}

/** The global fallback level for DMs, from the per-type prefs. */
function globalDmLevel(prefs: PushPrefs): NotifLevel {
  return prefs.directMessages ? "all" : "nothing";
}

export interface UseNotifLevelsReturn {
  /** The explicit level set for a scope key, or undefined (inherit). */
  getLevel: (scopeKey: string) => NotifLevel | undefined;
  /** Set (or clear, with `undefined`) the level for a scope key. */
  setLevel: (scopeKey: string, level: NotifLevel | undefined) => void;
  /**
   * The RESOLVED level for a NIP-29 channel, applying the cascade
   * (channel → server → global).
   */
  channelLevel: (relayUrl: string, groupId: string) => NotifLevel;
  /** The resolved level for a Concord channel (channel → community → global). */
  concordChannelLevel: (
    protocol: "c1" | "c2",
    communityId: string,
    channelIdHex: string,
  ) => NotifLevel;
  /** The resolved level for a community (community → global). */
  communityLevel: (railKey: string) => NotifLevel;
  /** The resolved level for a DM (dm → global). */
  dmLevel: (pubkey: string) => NotifLevel;
}

/** Merge the explicit `notifLevels` map with the legacy mute sets (as `nothing`). */
function effectiveMap(
  levels: Record<string, NotifLevel>,
  mutedCommunities: string[],
  mutedChannels: string[],
): Map<string, NotifLevel> {
  const m = new Map<string, NotifLevel>();
  // Legacy mutes first (lowest precedence), so an explicit level overrides them.
  for (const key of mutedCommunities) m.set(communityScopeKey(key), "nothing");
  for (const key of mutedChannels) m.set(key, "nothing");
  for (const [key, level] of Object.entries(levels)) m.set(key, level);
  return m;
}

export function useNotifLevels(): UseNotifLevelsReturn {
  const { config, updateConfig } = useAppContext();

  const map = useMemo(
    () => effectiveMap(config.notifLevels, config.mutedCommunities, config.mutedChannels),
    [config.notifLevels, config.mutedCommunities, config.mutedChannels],
  );

  const getLevel = useCallback((scopeKey: string) => map.get(scopeKey), [map]);

  const setLevel = useCallback(
    (scopeKey: string, level: NotifLevel | undefined) => {
      updateConfig((current) => {
        const nextLevels = { ...current.notifLevels };
        if (level === undefined) delete nextLevels[scopeKey];
        else nextLevels[scopeKey] = level;

        // Keep the legacy mute sets in lock-step so older clients and the relay
        // push gateway (which reads `muted_groups`) still honor a `nothing`
        // level, and drop a scope from them when it's no longer `nothing`.
        // Channel keys contain `::`; community keys are a bare relay URL or a
        // `c1:`/`c2:` rail key; DM keys (`dm:…`) belong to neither mute set.
        const isChannel = scopeKey.includes("::");
        const isDm = scopeKey.startsWith("dm:");
        const muteSetKey: "mutedCommunities" | "mutedChannels" | null = isDm
          ? null
          : isChannel
            ? "mutedChannels"
            : "mutedCommunities";

        if (muteSetKey) {
          const muteSet = new Set(current[muteSetKey]);
          if (level === "nothing") muteSet.add(scopeKey);
          else muteSet.delete(scopeKey);
          return {
            ...current,
            notifLevels: nextLevels,
            [muteSetKey]: [...muteSet].sort(),
          };
        }
        return { ...current, notifLevels: nextLevels };
      });
    },
    [updateConfig],
  );

  const communityLevel = useCallback(
    (railKey: string): NotifLevel => {
      const explicit = map.get(communityScopeKey(railKey));
      return explicit ?? globalChannelLevel(loadPrefs());
    },
    [map],
  );

  const channelLevel = useCallback(
    (relayUrl: string, groupId: string): NotifLevel => {
      const own = map.get(channelScopeKey(relayUrl, groupId));
      if (own) return own;
      const server = map.get(communityScopeKey(relayUrl));
      if (server) return server;
      return globalChannelLevel(loadPrefs());
    },
    [map],
  );

  const concordChannelLevel = useCallback(
    (protocol: "c1" | "c2", communityId: string, channelIdHex: string): NotifLevel => {
      const own = map.get(concordChannelScopeKey(protocol, communityId, channelIdHex));
      if (own) return own;
      const community = map.get(`${protocol}:${communityId}`);
      if (community) return community;
      return globalChannelLevel(loadPrefs());
    },
    [map],
  );

  const dmLevel = useCallback(
    (pubkey: string): NotifLevel => {
      const own = map.get(dmScopeKey(pubkey));
      return own ?? globalDmLevel(loadPrefs());
    },
    [map],
  );

  return {
    getLevel,
    setLevel,
    channelLevel,
    concordChannelLevel,
    communityLevel,
    dmLevel,
  };
}
