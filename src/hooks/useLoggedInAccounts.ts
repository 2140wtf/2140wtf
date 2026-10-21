import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { NSchema as n, NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { useEffect } from 'react';

import { authorQueryOptions, parseAuthorEvent } from '@/hooks/useAuthor';
import { useEventStore } from '@/hooks/useEventStore';
import { useNostrStorage } from '@/hooks/useNostrStorage';

import type { AuthorResult } from '@/hooks/useAuthor';

export interface Account {
  id: string;
  pubkey: string;
  event?: NostrEvent;
  metadata: NostrMetadata;
}

export function useLoggedInAccounts() {
  const { nostr } = useNostr();
  const { logins, setLogin, removeLogin } = useNostrLogin();
  const queryClient = useQueryClient();
  const eventStore = useEventStore();
  const { store } = useNostrStorage();

  // Seed every logged-in account's profile from the local event store so names
  // and nip05 identifiers render instantly, instead of waiting on (or missing)
  // the relay round-trip. Runs in parallel with the queries below; the network
  // result stays authoritative and overwrites the seed when it resolves.
  useEffect(() => {
    if (logins.length === 0) return;
    let cancelled = false;
    void (async () => {
      const pubkeys = logins.map((l) => l.pubkey);
      const cachedEvents = await store.query([{ kinds: [0], authors: pubkeys }]);
      if (cancelled || cachedEvents.length === 0) return;
      for (const event of cachedEvents) {
        const current = queryClient.getQueryData<AuthorResult>(['author', event.pubkey]);
        if (current?.event && current.event.created_at >= event.created_at) {
          continue;
        }
        queryClient.setQueryData<AuthorResult>(['author', event.pubkey], parseAuthorEvent(event));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logins, store, queryClient]);

  const results = useQueries({
    queries: logins.map((login) => authorQueryOptions(nostr, queryClient, eventStore, login.pubkey)),
  });

  const authors: Account[] = logins.map((login, index) => {
    const data = results[index]?.data;
    let metadata: NostrMetadata = {};
    try {
      if (data?.metadata) {
        metadata = data.metadata;
      } else if (data?.event?.content) {
        metadata = n.json().pipe(n.metadata()).parse(data.event.content);
      }
    } catch {
      metadata = {};
    }
    return {
      id: login.id,
      pubkey: login.pubkey,
      event: data?.event,
      metadata,
    };
  });

  const isLoading = results.some((r) => r.isLoading);

  // Current user is the first login
  const currentUser: Account | undefined = logins[0]
    ? (authors.find((a) => a.id === logins[0].id) ?? authors[0])
    : undefined;

  // Other users are all logins except the current one
  const otherUsers = authors.slice(1);

  return {
    authors,
    currentUser,
    otherUsers,
    isLoading,
    setLogin,
    removeLogin,
  };
}
