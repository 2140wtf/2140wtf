import { useMemo } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGroupChatContext } from '@/hooks/useGroupChatContext';
import { useGroupChatReadCursors } from '@/hooks/useGroupChatReadCursors';

export function useGroupChatHasUnread() {
  const { user } = useCurrentUser();
  const { groups, getMessagesForGroup } = useGroupChatContext();
  const { getCursor } = useGroupChatReadCursors();

  const unreadGroups = useMemo(() => {
    if (!user) return [];

    return groups
      .map((group) => {
        const cursor = getCursor(group.nostrGroupId);
        const memberSet = new Set(group.members);
        const groupMessages = getMessagesForGroup(group.nostrGroupId).filter((m) =>
          memberSet.has(m.senderPubkey),
        );
        const unreadCount = groupMessages.reduce((count, message) => {
          if (message.senderPubkey === user.pubkey) return count;
          return message.timestamp > cursor ? count + 1 : count;
        }, 0);
        return { group, unreadCount };
      })
      .filter(({ unreadCount }) => unreadCount > 0);
  }, [groups, getMessagesForGroup, getCursor, user]);

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
