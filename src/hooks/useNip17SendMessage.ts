import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import { useMemo, useState } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { buildNip17GiftWraps, type Rumor } from '@/lib/nip17';
import { extractReadRelays } from '@/lib/inboxRelays';
import { extractDmRelays } from '@/hooks/useDmRelays';
import { APP_RELAYS } from '@/lib/appRelays';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useToast } from '@/hooks/useToast';

export interface SendNip17MessageOptions {
  recipientPubkey: string;
  content: string;
  /** Inner rumor kind. Defaults to kind 14 (direct message). */
  kind?: number;
  subject?: string;
  replyTo?: { eventId: string; relayUrl?: string };
  /** Additional tags to include on the inner rumor (e.g. Gamma Markets order tags). */
  extraTags?: string[][];
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

  const defaultRelays = useMemo(() => {
    const configured =
      config.relayMetadata?.relays
        ?.map((r) => r.url)
        .filter((url): url is string => typeof url === 'string' && /^wss?:\/\//.test(url)) ?? [];
    const appDefaults = APP_RELAYS.relays
      .map((r) => r.url)
      .filter((url): url is string => typeof url === 'string' && /^wss?:\/\//.test(url));
    return [...new Set([...configured, ...appDefaults])];
  }, [config.relayMetadata]);

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
      const { recipientPubkey, content, kind, subject, replyTo, extraTags } = options;

      const [senderDmRelays, recipientDmRelays] = await Promise.all([
        fetchDmRelays(nostr, user.pubkey, AbortSignal.timeout(5000)),
        fetchDmRelays(nostr, recipientPubkey, AbortSignal.timeout(5000)),
      ]);

      const { rumor, wraps } = await buildNip17GiftWraps(
        user.signer,
        [recipientPubkey],
        content,
        { kind, subject, replyTo, extraTags },
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
            // Fall back to the app's default relays when the recipient (or the
            // sender for the self-copy) has no DM/inbox relays configured.
            // This keeps DMs working for users who haven't published a kind
            // 10050 or NIP-65 relay list yet.
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
