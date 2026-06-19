/**
 * useAwardDailyXp - Award XP for completed daily missions
 *
 * Completion is implicit (derived from progress vs target).
 * This hook calculates the total XP earned today and persists
 * the updated XP total to kind 11125 tags.
 *
 * Uses fetchFreshEvent to avoid stale-read overwrites when
 * multiple mutations race (e.g. item use XP + daily XP).
 */

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
import { buildXpTagUpdates } from '@/pets/core/lib/progression';
import { serializeProfileContent } from '@/pets/core/lib/missions';
import type { MissionsContent } from '@/pets/core/lib/missions';
import { totalDailyXp, totalDailyCoins } from '../lib/daily-missions';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AwardDailyXpRequest {
  /** Current missions state to calculate XP from */
  missions: MissionsContent;
}

export interface AwardDailyXpResult {
  xpAwarded: number;
  newTotalXp: number;
  coinsAwarded: number;
  newCoinTotal: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook to award XP for completed daily missions.
 *
 * @param updateProfileEvent - Callback to update profile in query cache
 */
export function useAwardDailyXp(
  updateProfileEvent: (event: import('@nostrify/nostrify').NostrEvent) => void,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ missions }: AwardDailyXpRequest): Promise<AwardDailyXpResult> => {
      if (!user?.pubkey) throw new Error('Must be logged in');

      const xpToAward = totalDailyXp(missions);
      const coinsToAward = totalDailyCoins(missions);
      if (xpToAward <= 0 && coinsToAward <= 0) {
        return { xpAwarded: 0, newTotalXp: 0, coinsAwarded: 0, newCoinTotal: 0 };
      }

      // Fetch fresh profile from relays to avoid stale-read overwrites
      const prev = await fetchFreshEvent(nostr, {
        kinds: [KIND_BLOBBONAUT_PROFILE],
        authors: [user.pubkey],
      });

      const freshProfile = prev ? parseBlobbonautEvent(prev) : undefined;

      // Idempotency: skip if rewards for this date were already claimed
      const alreadyClaimedDate = freshProfile?.dailyRewardsClaimedAt;
      if (alreadyClaimedDate === missions.date) {
        return {
          xpAwarded: 0,
          newTotalXp: freshProfile?.xp ?? 0,
          coinsAwarded: 0,
          newCoinTotal: freshProfile?.coins ?? 0,
        };
      }

      const currentXp = freshProfile?.xp ?? 0;
      const newTotalXp = currentXp + xpToAward;
      const currentCoins = freshProfile?.coins ?? 0;
      const newCoinTotal = currentCoins + coinsToAward;

      // Update XP, level, coins, and claimed-date tags
      const updatedTags = updateBlobbonautTags(
        prev?.tags ?? [],
        {
          ...buildXpTagUpdates(newTotalXp),
          coins: newCoinTotal.toString(),
          daily_rewards_claimed_at: missions.date,
        },
      );

      // Persist missions state to content field
      const content = serializeProfileContent(
        prev?.content ?? '',
        { missions },
      );

      const event = await publishEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content,
        tags: updatedTags,
        prev: prev ?? undefined,
      });

      updateProfileEvent(event);

      return { xpAwarded: xpToAward, newTotalXp, coinsAwarded: coinsToAward, newCoinTotal };
    },
    onSuccess: ({ xpAwarded, coinsAwarded }) => {
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user.pubkey] });
      }
      if (xpAwarded > 0 || coinsAwarded > 0) {
        toast({
          title: 'Daily Rewards Claimed!',
          description: `You earned ${xpAwarded} XP and ${coinsAwarded} coins from daily missions.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to Award XP',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// Legacy export name for backward compatibility during migration
export const useClaimMissionReward = useAwardDailyXp;
export type ClaimMissionRequest = AwardDailyXpRequest;
export type ClaimMissionResult = AwardDailyXpResult;
