import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from './useCurrentUser';
import { useNostrStorage } from './useNostrStorage';
import { fetchContactList, contactListPubkeys } from '@/lib/contactList';

/**
 * Fetch the current user's kind 3 follow list.
 */
export function useFollows() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { store } = useNostrStorage();

  return useQuery<string[]>({
    queryKey: ['follows', user?.pubkey],
    queryFn: async ({ signal }) => {
      if (!user) return [];
      const event = await fetchContactList(nostr, store, user.pubkey, { signal });
      return contactListPubkeys(event);
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
