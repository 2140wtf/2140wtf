import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { toast } from '@/hooks/useToast';
import { fetchFreshEvent } from '@/lib/fetchFreshEvent';

import {
  KIND_BLOBBONAUT_PROFILE,
  updateBlobbonautTags,
  parseBlobbonautEvent,
} from '@/pets/core/lib/pets';
import { getLocalDayString } from '@/pets/core/lib/pets';

import { BAO_RELAY_URL, aggregateBaoTradeActivity } from '../lib/bao-trade-parser';
import { calculateBaoReward, calculateBaoTier, getBaoTierLabel } from '../lib/bao-rewards';

export interface ClaimBaoTradeRewardsResult {
  coinsAwarded: number;
  newCoinTotal: number;
  newLifetimeBao: number;
  tier: number;
  tierLabel: string;
}

/**
 * Claim daily BAO coins earned from BAO trading activity.
 *
 * The mutation fetches fresh profile data and fresh BAO order events, so it
 * is safe to call repeatedly. It is idempotent per local day: calling it
 * twice on the same day returns 0 coins the second time.
 *
 * @param updateProfileEvent - Callback to update the cached profile event
 */
export function useClaimBaoTradeRewards(
  updateProfileEvent: (event: import('@nostrify/nostrify').NostrEvent) => void,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<ClaimBaoTradeRewardsResult> => {
      if (!user?.pubkey) throw new Error('Must be logged in');

      const today = getLocalDayString();

      // Fetch the latest BAO order events directly from the BAO relay.
      const relay = nostr.relay(BAO_RELAY_URL);
      const tradeEvents = await relay.query(
        [{ kinds: [38001], authors: [user.pubkey], limit: 1000 }],
        { signal: AbortSignal.timeout(15_000) },
      );
      const activity = aggregateBaoTradeActivity(tradeEvents);

      // Fetch the latest profile so we never overwrite concurrent updates.
      const prev = await fetchFreshEvent(nostr, {
        kinds: [KIND_BLOBBONAUT_PROFILE],
        authors: [user.pubkey],
      });

      const freshProfile = prev ? parseBlobbonautEvent(prev) : undefined;
      const lifetimeBao = freshProfile?.baoLifetimeVolume ?? 0;
      const claimedDate = freshProfile?.baoRewardsClaimedAt;

      const reward = calculateBaoReward(activity, lifetimeBao, claimedDate, today);

      if (!reward.claimable || reward.coins <= 0) {
        return {
          coinsAwarded: 0,
          newCoinTotal: freshProfile?.coins ?? 0,
          newLifetimeBao: lifetimeBao,
          tier: reward.tier,
          tierLabel: reward.tierLabel,
        };
      }

      const currentCoins = freshProfile?.coins ?? 0;
      const newCoinTotal = currentCoins + reward.coins;
      const newLifetimeBao = lifetimeBao + reward.coins;
      const newTier = calculateBaoTier(newLifetimeBao);

      const updatedTags = updateBlobbonautTags(prev?.tags ?? [], {
        coins: newCoinTotal.toString(),
        bao_lifetime_volume: newLifetimeBao.toString(),
        bao_tier: newTier.toString(),
        bao_rewards_claimed_at: today,
      });

      const event = await publishEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content: prev?.content ?? '',
        tags: updatedTags,
        prev: prev ?? undefined,
      });

      updateProfileEvent(event);

      return {
        coinsAwarded: reward.coins,
        newCoinTotal,
        newLifetimeBao,
        tier: newTier,
        tierLabel: getBaoTierLabel(newTier),
      };
    },
    onSuccess: ({ coinsAwarded, tierLabel }) => {
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user.pubkey] });
      }
      if (coinsAwarded > 0) {
        toast({
          title: 'BAO Trading Reward Claimed!',
          description: `+${coinsAwarded} BAO · Tier: ${tierLabel}`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to Claim BAO Reward',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
