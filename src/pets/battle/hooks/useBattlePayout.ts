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
  /** Number of demo ₿AO coins to award to the winner. */
  amount: number;
  /** Demo mode awards profile coins; real/bao modes are future Cashu extensions. */
  mode: 'demo' | 'real' | 'bao';
}

export interface BattlePayoutResult {
  newCoinTotal: number;
  amountAwarded: number;
}

/**
 * Hook to pay out demo credits after a pet battle.
 *
 * In demo mode the winner receives coins on the host's Blobbonaut profile.
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

      if (mode === 'real' || mode === 'bao') {
        throw new Error('Real sats payout is coming soon.');
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
          newCoinTotal: profile?.coins ?? 0,
        };
      }

      const currentCoins = profile?.coins ?? 0;
      const newCoinTotal = currentCoins + amount;

      const tags = updateBlobbonautTags(prev?.tags ?? [], {
        coins: newCoinTotal.toString(),
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

      return { amountAwarded: amount, newCoinTotal };
    },
    onSuccess: ({ amountAwarded, newCoinTotal }) => {
      if (amountAwarded > 0) {
        toast({
          title: 'Battle reward claimed!',
          description: `You received ${amountAwarded} ₿AO coins. Balance: ${newCoinTotal}.`,
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
