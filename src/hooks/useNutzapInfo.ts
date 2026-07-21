import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { NUTZAP_INFO_KIND, parseNutzapInfoEvent } from '@/lib/cashu/cashuNip60';

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
      const events = await nostr.query(
        [{ kinds: [NUTZAP_INFO_KIND], authors: [pubkey], limit: 1 }],
        { signal: c.signal },
      );
      return parseNutzapInfoEvent(events[0], pubkey);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
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
