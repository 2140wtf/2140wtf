import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';
import { fetchFreshPetsEvent } from '@/pets/core/lib/fetchFreshPetsEvent';

import {
  KIND_BLOBBONAUT_PROFILE,
  updateBlobbonautTags,
  parseBlobbonautEvent,
} from '@/pets/core/lib/pets';
import { getLocalDayString } from '@/pets/core/lib/pets';

import { BAO_RELAY_URL, aggregateBaoTradeActivity } from '../lib/bao-trade-parser';
import { calculateBaoReward, calculateBaoTier, getBaoTierLabel } from '../lib/bao-rewards';

export interface ClaimBaoTradeRewardsResult {
  satsAwarded: number;
  newSatsTotal: number;
  newLifetimeBao: number;
  tier: number;
  tierLabel: string;
}

/**
 * Claim daily ₿AO sats earned from ₿AO trading activity.
 *
 * The mutation fetches fresh profile data and fresh ₿AO order events, so it
 * is safe to call repeatedly. It is idempotent per local day: calling it
 * twice on the same day returns 0 sats the second time.
 *
 * @param updateProfileEvent - Callback to update the cached profile event
 */
export function useClaimBaoTradeRewards(
  updateProfileEvent: (event: import('@nostrify/nostrify').NostrEvent) => void,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<ClaimBaoTradeRewardsResult> => {
      if (!user?.pubkey) throw new Error('Must be logged in');

      const today = getLocalDayString();

      // Fetch the latest ₿AO order events directly from the ₿AO relay.
      const relay = nostr.relay(BAO_RELAY_URL);
      const tradeEvents = await relay.query(
        [{ kinds: [38001], authors: [user.pubkey], limit: 1000 }],
        { signal: AbortSignal.timeout(15_000) },
      );
      const activity = aggregateBaoTradeActivity(tradeEvents);

      // Fetch the latest profile so we never overwrite concurrent updates.
      const prev = await fetchFreshPetsEvent(nostr, {
        kinds: [KIND_BLOBBONAUT_PROFILE],
        authors: [user.pubkey],
      });

      const freshProfile = prev ? parseBlobbonautEvent(prev) : undefined;
      const lifetimeBao = freshProfile?.baoLifetimeVolume ?? 0;
      const claimedDate = freshProfile?.baoRewardsClaimedAt;

      const reward = calculateBaoReward(activity, lifetimeBao, claimedDate, today);

      if (!reward.claimable || reward.sats <= 0) {
        return {
          satsAwarded: 0,
          newSatsTotal: freshProfile?.sats ?? 0,
          newLifetimeBao: lifetimeBao,
          tier: reward.tier,
          tierLabel: reward.tierLabel,
        };
      }

      const currentSats = freshProfile?.sats ?? 0;
      const newSatsTotal = currentSats + reward.sats;
      const newLifetimeBao = lifetimeBao + reward.sats;
      const newTier = calculateBaoTier(newLifetimeBao);

      const updatedTags = updateBlobbonautTags(prev?.tags ?? [], {
        sats: newSatsTotal.toString(),
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
        satsAwarded: reward.sats,
        newSatsTotal,
        newLifetimeBao,
        tier: newTier,
        tierLabel: getBaoTierLabel(newTier),
      };
    },
    onSuccess: ({ satsAwarded, tierLabel }) => {
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user.pubkey] });
      }
      if (satsAwarded > 0) {
        toast({
          title: '₿AO Trading Reward Claimed!',
          description: `+${satsAwarded} ₿AO sats · Tier: ${tierLabel}`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to Claim ₿AO Reward',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
