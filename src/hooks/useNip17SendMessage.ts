import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useMemo, useState } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { buildNip17GiftWraps, type Rumor } from '@/lib/nip17';
import { extractReadRelays } from '@/lib/inboxRelays';
import { extractDmRelays } from '@/hooks/useDmRelays';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useToast } from '@/hooks/useToast';

export interface SendNip17MessageOptions {
  recipientPubkey: string;
  content: string;
  subject?: string;
  replyTo?: { eventId: string; relayUrl?: string };
}

export interface SendNip17MessageResult {
  rumor: Rumor;
  wrapIds: string[];
}

async function fetchDmRelays(
  nostr: { query: (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]> },
  pubkey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const dmListEvents = await nostr.query(
    [{ kinds: [10050], authors: [pubkey], limit: 1 }],
    { signal },
  );

  if (dmListEvents.length > 0) {
    const relays = extractDmRelays(dmListEvents[0]);
    if (relays.length > 0) return relays;
  }

  const nip65Events = await nostr.query(
    [{ kinds: [10002], authors: [pubkey], limit: 1 }],
    { signal },
  );

  if (nip65Events.length > 0) {
    const relays = extractReadRelays(nip65Events[0]);
    if (relays.length > 0) return relays;
  }

  return [];
}

/**
 * Hook for sending NIP-17 private direct messages.
 *
 * Builds an unsigned kind 14 rumor, seals it as kind 13, and gift-wraps it as
 * kind 1059 for both the recipient and the sender (self-copy). Each wrap is
 * published to the corresponding participant's DM relays, falling back to
 * NIP-65 inbox relays. The recipient's wrap is also fanned out to the sender's
 * inbox relays as a best-effort backup so sent messages remain recoverable.
 */
export function useNip17SendMessage() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { isEnabled } = usePublishPreferences();
  const { toast } = useToast();
  const [isPending, setIsPending] = useState(false);

  const defaultRelays = useMemo(
    () => config.relayMetadata?.relays?.map((r) => r.url).filter((url): url is string => typeof url === 'string' && /^wss?:\/\//.test(url)) ?? [],
    [config.relayMetadata],
  );

  const sendMessage = async (
    options: SendNip17MessageOptions,
  ): Promise<SendNip17MessageResult> => {
    if (!user) throw new Error('User not logged in');
    if (!isEnabled('directMessages')) {
      toast({
        title: 'Direct messages disabled',
        description: 'Turn on “Direct messages” in Settings → Privacy & Publishing to send messages.',
      });
      throw new Error('Direct messages publishing disabled');
    }
    if (!user.signer.nip44) throw new Error('Signer does not support NIP-44 encryption');

    setIsPending(true);
    try {
      const { recipientPubkey, content, subject, replyTo } = options;

      const [senderDmRelays, recipientDmRelays] = await Promise.all([
        fetchDmRelays(nostr, user.pubkey, AbortSignal.timeout(5000)),
        fetchDmRelays(nostr, recipientPubkey, AbortSignal.timeout(5000)),
      ]);

      const { rumor, wraps } = await buildNip17GiftWraps(
        user.signer,
        [recipientPubkey],
        content,
        { subject, replyTo },
      );

      if (wraps.length === 0) {
        throw new Error('Failed to build NIP-17 gift wraps');
      }

      const wrapIds = wraps.map((wrap) => wrap.id);

      // Map each wrap to the relays belonging to its `p`-tagged recipient.
      const relaysByRecipient = new Map<string, string[]>();
      relaysByRecipient.set(user.pubkey, senderDmRelays);
      relaysByRecipient.set(recipientPubkey, recipientDmRelays);

      await Promise.all(
        wraps.map(async (wrap) => {
          const pTag = wrap.tags.find(([name]) => name === 'p')?.[1];
          if (!pTag) return;

          let relays = relaysByRecipient.get(pTag) ?? [];
          if (relays.length === 0) {
            if (pTag === recipientPubkey) {
              throw new Error('Recipient has no DM relays configured');
            }
            // Self-copy: fall back to default app relays so sent messages remain visible.
            relays = defaultRelays;
          }

          if (relays.length === 0) {
            await nostr.event(wrap, { signal: AbortSignal.timeout(5000) });
          } else {
            await nostr.group(relays).event(wrap, { signal: AbortSignal.timeout(5000) });
          }
        }),
      );

      return { rumor, wrapIds };
    } finally {
      setIsPending(false);
    }
  };

  return { sendMessage, isPending };
}
