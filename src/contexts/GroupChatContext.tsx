import { useGroupChat } from '@/hooks/useGroupChat';
import { GroupChatContext } from '@/lib/groupChatContext';
import { useGroupChatReadCursorsSync } from '@/hooks/useGroupChatReadCursorsSync';

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
