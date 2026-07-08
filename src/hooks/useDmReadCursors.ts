import { useCallback, useMemo } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEncryptedSecureLocalStorage } from '@/hooks/useEncryptedSecureLocalStorage';
import type { Nip17Conversation } from '@/hooks/useNip17Inbox';

/**
 * Per-user per-conversation read cursors for NIP-17 DMs.
 *
 * The cursor is the `created_at` timestamp of the newest message the user has
 * seen in a given conversation. Messages with a greater timestamp are considered
 * unread. Stored in localStorage under a user-scoped key so switching accounts
 * keeps independent read states.
 */
export function useDmReadCursors() {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey ?? '';
  const nip44 = user?.signer?.nip44;
  const storageKey = useMemo(
    () => (pubkey ? `app:dm-read-cursors:${pubkey}` : 'app:dm-read-cursors:'),
    [pubkey],
  );

  const [cursors, setCursors] = useEncryptedSecureLocalStorage<Record<string, number>>(storageKey, {}, nip44, pubkey);

  const getCursor = useCallback(
    (conversationId: string) => cursors[conversationId] ?? 0,
    [cursors],
  );

  const setCursor = useCallback(
    (conversationId: string, timestamp: number) => {
      setCursors((prev) => {
        if (prev[conversationId] === timestamp) return prev;
        return { ...prev, [conversationId]: timestamp };
      });
    },
    [setCursors],
  );

  const markConversationRead = useCallback(
    (conversation: Nip17Conversation | undefined) => {
      if (!conversation) return;
      const newest = conversation.lastMessageAt;
      if (newest > 0) {
        setCursor(conversation.id, newest);
      }
    },
    [setCursor],
  );

  const markAllConversationsRead = useCallback(
    (conversations: Nip17Conversation[]) => {
      setCursors((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const conversation of conversations) {
          const newest = conversation.lastMessageAt;
          if (newest > 0 && next[conversation.id] !== newest) {
            next[conversation.id] = newest;
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
    markConversationRead,
    markAllConversationsRead,
  };
}
