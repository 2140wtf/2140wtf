import { useNostr } from '@nostrify/react';
import { useEffect, useMemo, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  computeNip17ConversationId,
  getNip17Participants,
  unwrapNip17Message,
  type Nip17Message,
} from '@/lib/nip17';

export interface Nip17Conversation {
  id: string;
  /** Sorted pubkeys of the other participants (excluding the viewer). */
  participants: string[];
  messages: Nip17Message[];
  lastMessageAt: number;
  subject?: string;
}

/**
 * Subscribe to the logged-in user's NIP-17 gift-wrap inbox.
 *
 * Streams kind 1059 events `#p`-tagged for the user, unwraps and unseals them,
 * and groups the resulting kind 14 rumors into conversations keyed by the
 * sorted set of participants. Sent messages are recovered via the sender
 * self-copy and appear alongside received messages.
 */
export function useNip17Inbox() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const [conversations, setConversations] = useState<Map<string, Nip17Conversation>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!user || !user.signer.nip44) {
      setConversations(new Map());
      setIsLoading(false);
      return;
    }

    const ac = new AbortController();
    let alive = true;
    const signer = user.signer;
    const viewerPubkey = user.pubkey;

    async function processWrap(wrap: NostrEvent) {
      try {
        const message = await unwrapNip17Message(wrap, signer);
        if (!message) return;

        const participants = getNip17Participants(message, viewerPubkey);
        const id = computeNip17ConversationId([viewerPubkey, ...participants]);

        setConversations((prev) => {
          const existing = prev.get(id);
          if (existing?.messages.some((m) => m.id === message.id)) {
            return prev;
          }

          const messages = existing
            ? [...existing.messages, message]
            : [message];
          messages.sort((a, b) => a.createdAt - b.createdAt);

          const lastMessageAt = messages[messages.length - 1]?.createdAt ?? message.createdAt;
          const subject = message.subject ?? existing?.subject;

          const next = new Map(prev);
          next.set(id, {
            id,
            participants,
            messages,
            lastMessageAt,
            subject,
          });
          return next;
        });
      } catch {
        // Ignore malformed wraps; relays may send spam.
      }
    }

    (async () => {
      setIsLoading(true);

      try {
        const initial = await nostr.query(
          [{ kinds: [1059], '#p': [user.pubkey], limit: 100 }],
          { signal: ac.signal },
        );
        for (const wrap of initial) {
          if (!alive) break;
          await processWrap(wrap);
        }
      } catch {
        // Abort expected on unmount.
      }

      if (alive) setIsLoading(false);

      try {
        const now = Math.floor(Date.now() / 1000);
        for await (const msg of nostr.req(
          [{ kinds: [1059], '#p': [user.pubkey], since: now, limit: 0 }],
          { signal: ac.signal },
        )) {
          if (!alive) break;
          if (msg[0] === 'EVENT') {
            void processWrap(msg[2]);
          } else if (msg[0] === 'CLOSED') {
            break;
          }
        }
      } catch {
        // Abort expected on unmount.
      }
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [nostr, user]);

  const conversationList = useMemo(
    () =>
      Array.from(conversations.values()).sort(
        (a, b) => b.lastMessageAt - a.lastMessageAt,
      ),
    [conversations],
  );

  return { conversations: conversationList, isLoading };
}
