import { useContext, useMemo } from "react";

import { ChannelNavContext, normalizeChannelKey } from "@/contexts/ChannelNavContext";

import type { ChannelNavValue } from "@/contexts/ChannelNavContext";

/** The current chat scope's channel-name→navigation resolver, if any. */
export function useChannelNav(): ChannelNavValue | undefined {
  return useContext(ChannelNavContext);
}

/** A channel the current scope can navigate to by name. */
export interface NavChannel {
  name: string;
  /** Navigate to this channel (in-page selection or a route push). */
  go: () => void;
}

/**
 * Build a stable {@link ChannelNavValue} from the current scope's channels.
 * Matching is case-insensitive and slug-aware (see {@link normalizeChannelKey});
 * the first channel whose normalized name equals the normalized tag wins.
 */
export function useChannelNavValue(channels: NavChannel[]): ChannelNavValue {
  return useMemo<ChannelNavValue>(() => {
    const byKey = new Map<string, () => void>();
    for (const c of channels) {
      const key = normalizeChannelKey(c.name);
      // First match wins (channels are already in display order).
      if (key && !byKey.has(key)) byKey.set(key, c.go);
    }
    return {
      resolveChannelByName: (tag: string) => byKey.get(normalizeChannelKey(tag)) ?? null,
    };
  }, [channels]);
}
