import { createContext } from 'react';

import { useGroupChat, type UseGroupChatReturn } from '@/hooks/useGroupChat';
import { useGroupChatReadCursorsSync } from '@/hooks/useGroupChatReadCursorsSync';

export const GroupChatContext = createContext<UseGroupChatReturn | null>(null);

/**
 * Provides a single shared NIP-104 group-chat state for the whole app.
 *
 * Without this provider, every component that needs group chat state would
 * instantiate `useGroupChat`, creating duplicate kind 1059 / kind 445
 * subscriptions and duplicating in-memory group/message state. Wrapping the
 * app lets all consumers read the same live state.
 */
export function GroupChatProvider({ children }: { children: React.ReactNode }) {
  const value = useGroupChat();
  useGroupChatReadCursorsSync();
  return <GroupChatContext.Provider value={value}>{children}</GroupChatContext.Provider>;
}
