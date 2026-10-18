import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { NUTZAP_INFO_KIND, parseNutzapInfoEvent } from '@/lib/cashu/cashuNip60';

/**
 * How long a recipient's NIP-61 receive info may take before the pane falls
 * back to the NUT-18 DM rail. Kept short: the pooled query normally resolves on
 * the first relay EOSE, so anything slower is a stalled socket, and the user is
 * already looking at the send form while this runs (the zap dialog also
 * prefetches it as soon as it opens).
 */
const NUTZAP_LOOKUP_TIMEOUT_MS = 2500;

export interface NutzapInfo {
  /** P2PK pubkey (hex) the recipient uses to receive Nutzaps. */
  pubkey: string;
  /** Normalized mint URLs the recipient accepts for Nutzaps. */
  mints: string[];
  /** Relay hints published by the recipient for Nutzap delivery. */
  relays: string[];
}

/**
 * Read a pubkey's NIP-61 Nutzap receiver info (kind 10019).
 *
 * The event is verified and must be authored by the requested pubkey.
 * Returns `undefined` while loading, `null` when no valid info is found,
 * and the parsed info otherwise.
 */
export function useNutzapInfo(pubkey: string | undefined) {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['nutzap-info', pubkey],
    queryFn: async (c) => {
      if (!pubkey) return null;
      // Bounded: a recipient whose kind 10019 is missing (or whose relays are
      // slow) used to leave the zap dialog's Cashu pane spinning for many
      // seconds. On timeout the caller falls back to the NUT-18 DM rail, and
      // the result is cached for the next open.
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(NUTZAP_LOOKUP_TIMEOUT_MS)]);
      const events = await nostr.query(
        [{ kinds: [NUTZAP_INFO_KIND], authors: [pubkey], limit: 1 }],
        { signal },
      );
      return parseNutzapInfoEvent(events[0], pubkey);
    },
    enabled: !!pubkey,
    // Receive info changes rarely; keep the answer across dialog opens so the
    // second zap to the same artist renders the decided rail immediately.
    staleTime: 5 * 60 * 1000,
    // A failed lookup must resolve quickly into the fallback rail, not retry.
    retry: false,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
  };
}

/** Whether parsed Nutzap info is valid and has at least one accepted mint. */
export function canReceiveNutzap(info: NutzapInfo | null | undefined): boolean {
  return !!info && info.mints.length > 0 && !!info.pubkey;
}
