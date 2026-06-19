import { useCallback, useMemo } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import type { GroupChatGroup } from '@/lib/groupChatService';

export function useGroupChatReadCursors() {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey ?? '';
  const storageKey = useMemo(
    () => (pubkey ? `ditto:group-read-cursors:${pubkey}` : 'ditto:group-read-cursors:'),
    [pubkey],
  );

  const [cursors, setCursors] = useLocalStorage<Record<string, number>>(storageKey, {});

  const getCursor = useCallback(
    (groupId: string) => cursors[groupId] ?? 0,
    [cursors],
  );

  const setCursor = useCallback(
    (groupId: string, timestamp: number) => {
      setCursors((prev) => {
        if (prev[groupId] === timestamp) return prev;
        return { ...prev, [groupId]: timestamp };
      });
    },
    [setCursors],
  );

  const markGroupRead = useCallback(
    (group: GroupChatGroup | undefined, messages: import('@/lib/groupChatService').GroupChatMessage[]) => {
      if (!group) return;
      const newest = messages.reduce((max, message) => Math.max(max, message.timestamp), group.lastActivity);
      if (newest > 0) {
        setCursor(group.nostrGroupId, newest);
      }
    },
    [setCursor],
  );

  const markAllGroupsRead = useCallback(
    (groups: GroupChatGroup[], getMessages: (groupId: string) => import('@/lib/groupChatService').GroupChatMessage[]) => {
      setCursors((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const group of groups) {
          const newest = getMessages(group.nostrGroupId).reduce(
            (max, message) => Math.max(max, message.timestamp),
            group.lastActivity,
          );
          if (newest > 0 && next[group.nostrGroupId] !== newest) {
            next[group.nostrGroupId] = newest;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    [setCursors],
  );

  return {
    cursors,
    setCursors,
    getCursor,
    setCursor,
    markGroupRead,
    markAllGroupsRead,
  };
}
