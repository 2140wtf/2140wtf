import { type NostrEvent, type NostrMetadata, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCacheFirstSeed } from '@/hooks/useCacheFirstSeed';
import { useNostrStorage } from '@/hooks/useNostrStorage';

import type { EventStoreContextType } from '@/contexts/EventStoreContext';

export type AuthorResult = { event?: NostrEvent; metadata?: NostrMetadata };

type Nostr = ReturnType<typeof useNostr>['nostr'];

/**
 * The shared TanStack Query options for resolving a pubkey's kind-0 profile.
 * Extracted so both {@link useAuthor} (single) and batched resolvers
 * (`useQueries`, e.g. the ₿AO chat mention-name map) hit the exact same
 * `['author', pubkey]` cache with identical fetch/retry semantics —
 * newest-wins, event-store fallback on miss, relaxed background re-check
 * while a profile is missing.
 */
export function authorQueryOptions(
  nostr: Nostr,
  queryClient: QueryClient,
  eventStore: EventStoreContextType,
  pubkey: string | undefined,
) {
  return {
    queryKey: ['author', pubkey ?? ''] as [string, string],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<AuthorResult> => {
      if (!pubkey) {
        return {};
      }

      const store = await eventStore;

      const [event] = await nostr.query(
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        { signal },
      );

      if (!event) {
        // Relay returned nothing — a kind-0 miss is almost always transient
        // (the relay didn't have it, or the query timed out). Never discard a
        // profile we already have: fall back to the locally cached event so a
        // name/avatar already on screen doesn't blank out.
        const existing = queryClient.getQueryData<AuthorResult>(['author', pubkey]);
        if (existing?.event) {
          return existing;
        }
        const [cached] = await store.query([{ kinds: [0], authors: [pubkey] }]);
        if (cached) {
          return parseAuthorEvent(cached);
        }
        return {};
      }

      // Persist the fresh event to the local store (fire-and-forget).
      void store.event(event);

      return parseAuthorEvent(event);
    },
    enabled: !!pubkey,
    // A FOUND profile is cached long (5 min); a MISS is kept only briefly so a
    // profile that was cut off by the relay EOSE race is re-checked soon.
    staleTime: (query: { state: { data?: AuthorResult } }) =>
      query.state.data?.event ? 5 * 60 * 1000 : 30 * 1000,
    gcTime: 10 * 60 * 1000,
    // While a profile is missing AND the component is mounted, retry in the
    // background at a relaxed cadence so it fills in without a manual reload.
    refetchInterval: (query: { state: { data?: AuthorResult } }) =>
      query.state.data?.event ? false : 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  };
}

/** Parse a kind-0 event into metadata + event, or return just the event on parse failure. */
export function parseAuthorEvent(event: NostrEvent): { event: NostrEvent; metadata?: NostrMetadata } {
  try {
    const metadata = n.json().pipe(n.metadata()).parse(event.content);
    return { metadata, event };
  } catch {
    return { event };
  }
}

export function useAuthor(pubkey: string | undefined) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { store } = useNostrStorage();

  // Seed the query from the local event store so a known profile renders
  // immediately, without waiting on the network. The network query below
  // stays authoritative and overwrites this when it resolves.
  useCacheFirstSeed<AuthorResult>({
    queryKey: pubkey ? ['author', pubkey] : undefined,
    filter: { kinds: [0], authors: pubkey ? [pubkey] : [] },
    toData: parseAuthorEvent,
    getEvent: (data) => data.event,
  });

  return useQuery<AuthorResult>({
    queryKey: ['author', pubkey ?? ''],
    queryFn: async ({ signal }) => {
      if (!pubkey) {
        return {};
      }

      const [event] = await nostr.query(
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        { signal },
      );

      if (!event) {
        // Relay returned nothing — a kind-0 miss is almost always transient
        // (the relay didn't have it, or the query timed out). Never discard a
        // profile we already have: fall back to the locally cached event so a
        // name/avatar already on screen doesn't blank out.
        const existing = queryClient.getQueryData<AuthorResult>(['author', pubkey]);
        if (existing?.event) {
          return existing;
        }
        const [cached] = await store.query([{ kinds: [0], authors: [pubkey] }]);
        if (cached) {
          return parseAuthorEvent(cached);
        }
        return {};
      }

      // Persist the fresh event to the local store (fire-and-forget).
      void store.event(event);

      return parseAuthorEvent(event);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,   // 5 minutes
    gcTime: 10 * 60 * 1000,     // 10 minutes
    retry: 1,
  });
}
