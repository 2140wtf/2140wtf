import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { APP_RELAYS } from '@/lib/appRelays';
import { isVerifiedOwnEvent } from '@/lib/nostrEvents';
import {
  computeNip17ConversationId,
  getNip17DmRelays,
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

const DM_RELAYS_KIND = 10050;
const GIFT_WRAP_KIND = 1059;
/** NIP-59 allows gift wraps to be back-dated by up to two days. */
const GIFT_WRAP_MAX_AGE_SECONDS = 2 * 24 * 60 * 60;

function isValidRelayUrl(url: string): boolean {
  return /^wss?:\/\//.test(url);
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
  const { config } = useAppContext();
  const [conversations, setConversations] = useState<Map<string, Nip17Conversation>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const defaultRelays = useMemo(() => {
    const configured =
      config.relayMetadata?.relays
        ?.map((r) => r.url)
        .filter((url): url is string => typeof url === 'string' && isValidRelayUrl(url)) ?? [];
    const appDefaults = APP_RELAYS.relays
      .map((r) => r.url)
      .filter((url): url is string => typeof url === 'string' && isValidRelayUrl(url));
    return [...new Set([...configured, ...appDefaults])];
  }, [config.relayMetadata]);

  const { data: dmRelays } = useQuery({
    queryKey: ['nip17-dm-relays', user?.pubkey],
    queryFn: async ({ signal }) => {
      if (!user) return [];
      const events = await nostr.query(
        [{ kinds: [DM_RELAYS_KIND], authors: [user.pubkey], limit: 1 }],
        { signal },
      );
      const event = events[0];
      return event && isVerifiedOwnEvent(event, user.pubkey) ? getNip17DmRelays(event) : [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const readRelays = useMemo(() => {
    const relays = [...new Set([...(dmRelays ?? []), ...defaultRelays])];
    return relays.length > 0 ? relays : null;
  }, [dmRelays, defaultRelays]);

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

      const pool = readRelays ? nostr.group(readRelays) : nostr;

      try {
        const initial = await pool.query(
          [{ kinds: [GIFT_WRAP_KIND], '#p': [user.pubkey], limit: 100 }],
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
        const since = now - GIFT_WRAP_MAX_AGE_SECONDS - 60;
        for await (const msg of pool.req(
          [{ kinds: [GIFT_WRAP_KIND], '#p': [user.pubkey], since, limit: 0 }],
          { signal: ac.signal },
        )) {
          if (!alive) break;
          if (msg[0] === 'EVENT') {
            await processWrap(msg[2]);
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
  }, [nostr, user, readRelays]);

  const addMessage = useCallback((message: Nip17Message) => {
    if (!user) return;
    const participants = getNip17Participants(message, user.pubkey);
    const id = computeNip17ConversationId([user.pubkey, ...participants]);

    setConversations((prev) => {
      const existing = prev.get(id);
      if (existing?.messages.some((m) => m.id === message.id)) {
        return prev;
      }

      const messages = existing ? [...existing.messages, message] : [message];
      messages.sort((a, b) => a.createdAt - b.createdAt);

      const next = new Map(prev);
      next.set(id, {
        id,
        participants,
        messages,
        lastMessageAt: messages[messages.length - 1]?.createdAt ?? message.createdAt,
        subject: message.subject ?? existing?.subject,
      });
      return next;
    });
  }, [user]);

  const conversationList = useMemo(
    () =>
      Array.from(conversations.values()).sort(
        (a, b) => b.lastMessageAt - a.lastMessageAt,
      ),
    [conversations],
  );

  return { conversations: conversationList, isLoading, addMessage };
}
