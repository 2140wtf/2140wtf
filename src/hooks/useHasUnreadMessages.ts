import { useMemo } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDmReadCursors } from '@/hooks/useDmReadCursors';
import { useDmInbox } from '@/hooks/useDmInbox';

/**
 * Returns whether the user has unread NIP-17 DM messages, plus a per-conversation
 * breakdown. A message is unread if it is not from the viewer and its `createdAt`
 * is newer than the stored read cursor for its conversation.
 */
export function useHasUnreadMessages() {
  const { user } = useCurrentUser();
  const { conversations } = useDmInbox();
  const { getCursor } = useDmReadCursors();

  const unreadConversations = useMemo(() => {
    if (!user) return [];

    return conversations
      .map((conversation) => {
        const cursor = getCursor(conversation.id);
        const unreadCount = conversation.messages.reduce((count, message) => {
          if (message.sender === user.pubkey) return count;
          return message.createdAt > cursor ? count + 1 : count;
        }, 0);
        return { conversation, unreadCount };
      })
      .filter(({ unreadCount }) => unreadCount > 0);
  }, [conversations, getCursor, user]);

  const unreadCount = useMemo(
    () => unreadConversations.reduce((sum, { unreadCount }) => sum + unreadCount, 0),
    [unreadConversations],
  );

  return {
    hasUnread: unreadCount > 0,
    unreadCount,
    unreadConversations,
  };
}
