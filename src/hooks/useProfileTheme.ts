import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useCacheFirstSeed } from "@/hooks/useCacheFirstSeed";
import { useEventStore } from "@/hooks/useEventStore";
import { ACTIVE_THEME_KIND, parseDittoTheme, type DittoTheme } from "@/lib/themeEvent";

import type { NostrEvent } from "@nostrify/nostrify";

export type ProfileThemeResult = { event?: NostrEvent; theme?: DittoTheme };

/** The query key holding a pubkey's active Ditto theme (kind 16767). */
export function profileThemeQueryKey(pubkey: string): [string, string] {
  return ["profile-theme", pubkey];
}

/** Parse a kind-16767 event into { event, theme }, dropping the theme on parse failure. */
function parseProfileThemeEvent(event: NostrEvent): ProfileThemeResult {
  return { event, theme: parseDittoTheme(event) ?? undefined };
}

/**
 * A given user's active Ditto profile theme (replaceable kind 16767), read from
 * the app relays and persisted to the local store. Lets us tint UI showing that
 * person (e.g. the profile hovercard) with the colors they chose in Ditto.
 * Returns an empty result when they have no theme.
 *
 * Seeds cache-first from IndexedDB so a repeat open is instant, and the query
 * is batched with other kind-16767 lookups by the replaceable collector.
 */
export function useProfileTheme(pubkey: string | undefined) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const eventStore = useEventStore();

  useCacheFirstSeed<ProfileThemeResult>({
    queryKey: pubkey ? profileThemeQueryKey(pubkey) : undefined,
    filter: { kinds: [ACTIVE_THEME_KIND], authors: pubkey ? [pubkey] : [] },
    toData: parseProfileThemeEvent,
    getEvent: (data) => data.event,
  });

  return useQuery<ProfileThemeResult>({
    queryKey: profileThemeQueryKey(pubkey ?? ""),
    enabled: !!pubkey,
    // A theme rarely changes; a found one is cached long, a miss is re-checked
    // on the next access (batched, cheap).
    staleTime: (query) => (query.state.data?.event ? 5 * 60_000 : 60_000),
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async ({ signal }) => {
      if (!pubkey) return {};

      const store = await eventStore;

      const [event] = await nostr.query(
        [{ kinds: [ACTIVE_THEME_KIND], authors: [pubkey], limit: 1 }],
        { signal },
      );

      if (!event) {
        // Transient miss — keep whatever we already resolved.
        const existing = queryClient.getQueryData<ProfileThemeResult>(profileThemeQueryKey(pubkey));
        if (existing?.event) return existing;
        const [cached] = await store.query([{ kinds: [ACTIVE_THEME_KIND], authors: [pubkey] }]);
        if (cached) return parseProfileThemeEvent(cached);
        return {};
      }

      void store.event(event);
      return parseProfileThemeEvent(event);
    },
  });
}

/**
 * Returns a callback that warms a user's Ditto theme into the query cache ahead
 * of time (e.g. on hover of the profile trigger), so the hovercard is already
 * tinted the instant it opens. A no-op if the theme is already fresh in cache.
 */
export function usePrefetchProfileTheme(): (pubkey: string) => void {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const eventStore = useEventStore();

  return useCallback((pubkey: string) => {
    if (!pubkey) return;
    void queryClient.prefetchQuery<ProfileThemeResult>({
      queryKey: profileThemeQueryKey(pubkey),
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const [event] = await nostr.query(
          [{ kinds: [ACTIVE_THEME_KIND], authors: [pubkey], limit: 1 }],
          { signal: AbortSignal.timeout(6000) },
        );
        if (!event) return {};
        const store = await eventStore;
        void store.event(event);
        return parseProfileThemeEvent(event);
      },
    });
  }, [nostr, queryClient, eventStore]);
}
