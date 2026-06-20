import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';

import {
  BAO_POSITION_SYNC_KIND,
  BAO_SYNC_RELAYS,
  aggregateBaoPositionSync,
  emptyBaoTradeActivity,
  generateBaoPositionDTag,
  parsePositionSyncData,
  type BaoTradeActivity,
} from '../lib/bao-position-sync';

export interface UseBaoTradeStatsResult {
  activity: BaoTradeActivity | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch the logged-in user's BAO trading activity from their NIP-78
 * position-sync event.
 *
 * BAO Markets stores individual trades as NIP-44 self-encrypted, NIP-59
 * gift-wrapped events. To preserve privacy Pets never unwraps those gift-wraps;
 * instead it reads the user's own kind 30078 position-sync event, decrypts it
 * with the user's signer, and derives open-order totals from the synced
 * positions.
 */
export function useBaoTradeStats(pubkey: string | undefined): UseBaoTradeStatsResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const query = useQuery({
    queryKey: ['bao-trade-stats', pubkey ?? 'anon'],
    queryFn: async (c): Promise<BaoTradeActivity> => {
      if (!pubkey || !user?.pubkey || user.pubkey !== pubkey || !user.signer?.nip44?.decrypt) {
        return emptyBaoTradeActivity();
      }

      const dTag = generateBaoPositionDTag(pubkey);
      const pool = nostr.group([...BAO_SYNC_RELAYS]);
      const events = await pool.query(
        [{ kinds: [BAO_POSITION_SYNC_KIND], authors: [pubkey], '#d': [dTag], limit: 1 }],
        { signal: c.signal },
      );

      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) {
        return emptyBaoTradeActivity();
      }

      try {
        const decrypted = await user.signer.nip44.decrypt(pubkey, latest.content);
        const data = parsePositionSyncData(decrypted.trimEnd());
        if (!data) return emptyBaoTradeActivity();
        return aggregateBaoPositionSync(data);
      } catch (error) {
        console.error('Failed to decrypt BAO position-sync event:', error);
        return emptyBaoTradeActivity();
      }
    },
    enabled: !!pubkey,
    staleTime: 60 * 1000,
  });

  return {
    activity: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
