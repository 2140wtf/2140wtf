import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';
import { fetchFreshPetsEvent } from '@/pets/core/lib/fetchFreshPetsEvent';
import {
  KIND_BLOBBONAUT_PROFILE,
  parseBlobbonautEvent,
  updateBlobbonautTags,
  getLocalDayString,
} from '@/pets/core/lib/pets';
import { serializeProfileContent } from '@/pets/core/lib/missions';

export interface BattlePayoutRequest {
  /** Number of demo sats to award to the winner. */
  amount: number;
  /** 'demo-sats' awards profile sats; 'btc-sats' is a future real-sat extension. */
  mode: 'demo-sats' | 'btc-sats';
}

export interface BattlePayoutResult {
  newSatsTotal: number;
  amountAwarded: number;
}

/**
 * Hook to pay out demo credits after a pet battle.
 *
 * In demo-sats mode the winner receives sats on the host's Blobbonaut profile.
 * A `battle_rewards_claimed_at` tag caps earnings to one payout per local day.
 * Real Cashu mode is intentionally left as a stub for the next phase.
 */
export function useBattlePayout(
  updateProfileEvent: (event: NostrEvent) => void,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();

  return useMutation<BattlePayoutResult, Error, BattlePayoutRequest>({
    mutationFn: async ({ amount, mode }) => {
      if (!user?.pubkey) {
        throw new Error('You must be logged in to collect battle rewards.');
      }

      if (mode === 'btc-sats') {
        throw new Error('BTC sats payout is coming soon.');
      }

      const prev = await fetchFreshPetsEvent(nostr, {
        kinds: [KIND_BLOBBONAUT_PROFILE],
        authors: [user.pubkey],
      });

      const profile = prev ? parseBlobbonautEvent(prev) : undefined;
      const today = getLocalDayString();

      // Daily cap: one demo battle prize per day.
      if (profile?.allTags.some((tag) => tag[0] === 'battle_rewards_claimed_at' && tag[1] === today)) {
        return {
          amountAwarded: 0,
          newSatsTotal: profile?.sats ?? 0,
        };
      }

      const currentSats = profile?.sats ?? 0;
      const newSatsTotal = currentSats + amount;

      const tags = updateBlobbonautTags(prev?.tags ?? [], {
        sats: newSatsTotal.toString(),
        battle_rewards_claimed_at: today,
      });

      const content = serializeProfileContent(prev?.content ?? '', {});

      const event = await publishEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content,
        tags,
        prev: prev ?? undefined,
      });

      updateProfileEvent(event);

      return { amountAwarded: amount, newSatsTotal };
    },
    onSuccess: ({ amountAwarded, newSatsTotal }) => {
      if (amountAwarded > 0) {
        toast({
          title: 'Battle reward claimed!',
          description: `You received ${amountAwarded.toLocaleString()} demo sats. Balance: ${newSatsTotal.toLocaleString()}.`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Payout failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
