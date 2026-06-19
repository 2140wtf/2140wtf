import { useMemo } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGroupChatContext } from '@/hooks/useGroupChatContext';
import { useGroupChatReadCursors } from '@/hooks/useGroupChatReadCursors';

export function useGroupChatHasUnread() {
  const { user } = useCurrentUser();
  const { groups, messages: allMessages } = useGroupChatContext();
  const { getCursor } = useGroupChatReadCursors();

  const unreadGroups = useMemo(() => {
    if (!user) return [];

    return groups
      .map((group) => {
        const cursor = getCursor(group.nostrGroupId);
        const groupMessages = allMessages.filter((m) => m.nostrGroupId === group.nostrGroupId);
        const unreadCount = groupMessages.reduce((count, message) => {
          if (message.senderPubkey === user.pubkey) return count;
          return message.timestamp > cursor ? count + 1 : count;
        }, 0);
        return { group, unreadCount };
      })
      .filter(({ unreadCount }) => unreadCount > 0);
  }, [groups, allMessages, getCursor, user]);

  const unreadCount = useMemo(
    () => unreadGroups.reduce((sum, { unreadCount }) => sum + unreadCount, 0),
    [unreadGroups],
  );

  return {
    hasUnread: unreadCount > 0,
    unreadCount,
    unreadGroups,
  };
}
