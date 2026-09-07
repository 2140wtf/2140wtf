import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { APP_RELAYS } from '@/lib/appRelays';
import { isVerifiedOwnEvent } from '@/lib/nostrEvents';
import { extractReadRelays } from '@/lib/inboxRelays';
import { paginateBackfill } from '@/lib/nip17Backfill';
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
const NIP65_RELAYS_KIND = 10002;
const GIFT_WRAP_KIND = 1059;
/** NIP-59 allows gift wraps to be back-dated by up to two days. */
const GIFT_WRAP_MAX_AGE_SECONDS = 2 * 24 * 60 * 60;
/** Retry delay after the live subscription ends (all relays CLOSED). */
const LIVE_RESUBSCRIBE_DELAY_MS = 3_000;
/** Upper bound on inbox sockets — dedup keeps priority order intact. */
const INBOX_MAX_RELAYS = 16;

function isValidRelayUrl(url: string): boolean {
  return /^wss?:\/\//.test(url);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    }, { once: true });
  });
}

/**
 * Subscribe to the logged-in user's NIP-17 gift-wrap inbox.
 *
 * Streams kind 1059 events `#p`-tagged for the user, unwraps and unseals them,
 * and groups the resulting kind 14 rumors into conversations keyed by the
 * sorted set of participants. Sent messages are recovered via the sender
 * self-copy and appear alongside received messages.
 *
 * Read-set completeness: senders deliver wraps to the recipient's kind-10050
 * DM relays, falling back to their NIP-65 read relays (mirroring
 * `useNip17SendMessage.fetchDmRelays`). The inbox therefore reads BOTH lists
 * — skipping NIP-65 makes wraps published there permanently invisible.
 *
 * Backfill completeness: a single `limit: N` page resolves on first-relay
 * EOSE (+ grace), so its result is timing-dependent. The backfill paginates
 * backwards with `until` cursors until the inbox is exhausted.
 *
 * Liveness: NPool forwards CLOSED only when every relay closes, after which
 * the generator ends; the live subscription re-opens with a fresh cursor so
 * a network blip cannot silently stop delivery.
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

  // NIP-65 read relays — the delivery fallback for senders targeting users
  // without a kind-10050 list. Wraps published here MUST be readable.
  const { data: nip65ReadRelays } = useQuery({
    queryKey: ['nip17-nip65-read-relays', user?.pubkey],
    queryFn: async ({ signal }) => {
      if (!user) return [];
      const events = await nostr.query(
        [{ kinds: [NIP65_RELAYS_KIND], authors: [user.pubkey], limit: 1 }],
        { signal },
      );
      const event = events[0];
      return event && isVerifiedOwnEvent(event, user.pubkey) ? extractReadRelays(event) : [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const readRelays = useMemo(() => {
    const relays = [
      ...new Set([
        ...(dmRelays ?? []),
        ...(nip65ReadRelays ?? []),
        ...defaultRelays,
      ]),
    ]
      .filter(isValidRelayUrl)
      .slice(0, INBOX_MAX_RELAYS);
    return relays.length > 0 ? relays : null;
  }, [dmRelays, nip65ReadRelays, defaultRelays]);

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
        // Complete backwards-paginated backfill (not a single racy page).
        for await (const wrap of paginateBackfill(
          (filter) => pool.query([filter], { signal: ac.signal }),
          { pubkey: user.pubkey, kind: GIFT_WRAP_KIND },
        )) {
          if (!alive) return;
          await processWrap(wrap);
        }
      } catch {
        // Abort expected on unmount.
      }

      if (alive) setIsLoading(false);

      // Live subscription. Back-dating cover: a wrap published at time T
      // carries created_at ≥ T − 2d, so `since = backfillStart − 2d` sees
      // every wrap published after the backfill began, regardless of how far
      // the sender back-dated it. Re-opens on end so a full CLOSED cannot
      // silently stop delivery; duplicates are dropped by message id.
      const backfillStartedAt = Math.floor(Date.now() / 1000);
      const since = backfillStartedAt - GIFT_WRAP_MAX_AGE_SECONDS - 60;

      while (alive && !ac.signal.aborted) {
        try {
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
          // Abort expected on unmount; otherwise fall through and retry.
        }
        if (!alive || ac.signal.aborted) break;
        await sleep(LIVE_RESUBSCRIBE_DELAY_MS, ac.signal);
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
