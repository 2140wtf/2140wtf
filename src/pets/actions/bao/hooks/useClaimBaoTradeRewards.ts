import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';
import { fetchFreshPetsEvent } from '@/pets/core/lib/fetchFreshPetsEvent';

import {
  KIND_NOSTR_PET_PROFILE,
  updateNostrPetProfileTags,
  parseNostrPetProfileEvent,
} from '@/pets/core/lib/pets';
import { getLocalDayString } from '@/pets/core/lib/pets';

import {
  BAO_POSITION_SYNC_KIND,
  BAO_SYNC_RELAYS,
  aggregateBaoPositionSync,
  emptyBaoTradeActivity,
  generateBaoPositionDTag,
  parsePositionSyncData,
} from '../lib/bao-position-sync';
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

      // Fetch the latest NIP-78 position-sync event from the BAO relays and
      // decrypt it with the user's signer. We intentionally do not unwrap
      // NIP-59 gift-wrapped trades; the sync event is the privacy-safe source
      // of truth for open positions.
      const dTag = generateBaoPositionDTag(user.pubkey);
      const pool = nostr.group([...BAO_SYNC_RELAYS]);
      const syncEvents = await pool.query(
        [{ kinds: [BAO_POSITION_SYNC_KIND], authors: [user.pubkey], '#d': [dTag], limit: 1 }],
        { signal: AbortSignal.timeout(15_000) },
      );

      const latestSync = syncEvents.sort((a, b) => b.created_at - a.created_at)[0];
      let activity = emptyBaoTradeActivity();
      if (latestSync && user.signer?.nip44?.decrypt) {
        try {
          const decrypted = await user.signer.nip44.decrypt(user.pubkey, latestSync.content);
          const data = parsePositionSyncData(decrypted.trimEnd());
          if (data) {
            activity = aggregateBaoPositionSync(data);
          }
        } catch (error) {
          console.error('Failed to decrypt BAO position-sync event during claim:', error);
        }
      }

      // Fetch the latest profile so we never overwrite concurrent updates.
      const prev = await fetchFreshPetsEvent(nostr, {
        kinds: [KIND_NOSTR_PET_PROFILE],
        authors: [user.pubkey],
      });

      const freshProfile = prev ? parseNostrPetProfileEvent(prev) : undefined;
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

      const updatedTags = updateNostrPetProfileTags(prev?.tags ?? [], {
        sats: newSatsTotal.toString(),
        bao_lifetime_volume: newLifetimeBao.toString(),
        bao_tier: newTier.toString(),
        bao_rewards_claimed_at: today,
      });

      const event = await publishEvent({
        kind: KIND_NOSTR_PET_PROFILE,
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
        queryClient.invalidateQueries({ queryKey: ['nostr-pet-profile', user.pubkey] });
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
