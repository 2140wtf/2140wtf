/**
 * useAwardDailySats - Award sats for completed daily missions
 *
 * Completion is implicit (derived from progress vs target).
 * This hook calculates the total sats earned today, persists the updated
 * sats balance to kind 11125 tags, and records the claim date so rewards
 * are not double-claimed.
 *
 * Uses fetchFreshEvent to avoid stale-read overwrites when
 * multiple mutations race (e.g. action sats + daily sats).
 */

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
import { serializeProfileContent } from '@/pets/core/lib/missions';
import type { MissionsContent } from '@/pets/core/lib/missions';
import { totalDailySats } from '../lib/daily-missions';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AwardDailySatsRequest {
  /** Current missions state to calculate sats from */
  missions: MissionsContent;
}

export interface AwardDailySatsResult {
  satsAwarded: number;
  newSatsTotal: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook to award demo sats for completed daily missions.
 *
 * @param updateProfileEvent - Callback to update profile in query cache
 */
export function useAwardDailySats(
  updateProfileEvent: (event: import('@nostrify/nostrify').NostrEvent) => void,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ missions }: AwardDailySatsRequest): Promise<AwardDailySatsResult> => {
      if (!user?.pubkey) throw new Error('Must be logged in');

      const satsToAward = totalDailySats(missions);
      if (satsToAward <= 0) {
        return { satsAwarded: 0, newSatsTotal: 0 };
      }

      // Fetch fresh profile from relays to avoid stale-read overwrites
      const prev = await fetchFreshPetsEvent(nostr, {
        kinds: [KIND_NOSTR_PET_PROFILE],
        authors: [user.pubkey],
      });

      const freshProfile = prev ? parseNostrPetProfileEvent(prev) : undefined;

      // Idempotency: skip if rewards for this date were already claimed
      const alreadyClaimedDate = freshProfile?.dailyRewardsClaimedAt;
      if (alreadyClaimedDate === missions.date) {
        return {
          satsAwarded: 0,
          newSatsTotal: freshProfile?.sats ?? 0,
        };
      }

      const currentSats = freshProfile?.sats ?? 0;
      const newSatsTotal = currentSats + satsToAward;

      // Update sats and claimed-date tags
      const updatedTags = updateNostrPetProfileTags(prev?.tags ?? [], {
        sats: newSatsTotal.toString(),
        daily_rewards_claimed_at: missions.date,
      });

      // Persist missions state to content field
      const content = serializeProfileContent(prev?.content ?? '', { missions });

      const event = await publishEvent({
        kind: KIND_NOSTR_PET_PROFILE,
        content,
        tags: updatedTags,
        prev: prev ?? undefined,
      });

      updateProfileEvent(event);

      return { satsAwarded: satsToAward, newSatsTotal };
    },
    onSuccess: ({ satsAwarded }) => {
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['nostr-pet-profile', user.pubkey] });
      }
      if (satsAwarded > 0) {
        toast({
          title: 'Daily Rewards Claimed!',
          description: `You earned ${satsAwarded.toLocaleString()} demo sats from daily missions.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to claim daily rewards',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// Legacy export names for backward compatibility during migration
export const useAwardDailyXp = useAwardDailySats;
export const useClaimMissionReward = useAwardDailySats;
export type AwardDailyXpRequest = AwardDailySatsRequest;
export type AwardDailyXpResult = AwardDailySatsResult;
export type ClaimMissionRequest = AwardDailySatsRequest;
export type ClaimMissionResult = AwardDailySatsResult;
