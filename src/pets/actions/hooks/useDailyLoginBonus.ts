/**
 * useDailyLoginBonus - Award a daily login coin bonus
 *
 * Checks the Blobbonaut profile once per session and, if the user hasn't
 * received a login bonus today, awards coins and updates the profile.
 */

import { useCallback, useEffect, useRef } from 'react';
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
import { calculateDailyLoginBonus } from '../lib/daily-login-bonus';

export interface DailyLoginBonusResult {
  awarded: boolean;
  coinsAwarded: number;
  streak: number;
}

/**
 * Hook to claim the daily login bonus.
 *
 * @param updateProfileEvent - Callback to update profile in query cache
 */
export function useDailyLoginBonus(
  updateProfileEvent: (event: import('@nostrify/nostrify').NostrEvent) => void,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  const mutate = useMutation({
    mutationFn: async (): Promise<DailyLoginBonusResult> => {
      if (!user?.pubkey) throw new Error('Must be logged in');

      const prev = await fetchFreshEvent(nostr, {
        kinds: [KIND_BLOBBONAUT_PROFILE],
        authors: [user.pubkey],
      });

      if (!prev) {
        return { awarded: false, coinsAwarded: 0, streak: 0 };
      }

      const freshProfile = parseBlobbonautEvent(prev);
      if (!freshProfile) {
        return { awarded: false, coinsAwarded: 0, streak: 0 };
      }

      const bonus = calculateDailyLoginBonus(
        freshProfile.dailyLoginLastDay,
        freshProfile.dailyLoginStreak ?? 0,
      );

      if (!bonus.awarded) {
        return { awarded: false, coinsAwarded: 0, streak: bonus.streak };
      }

      const currentCoins = freshProfile.coins;
      const newCoins = currentCoins + bonus.coinsAwarded;

      const updatedTags = updateBlobbonautTags(prev?.tags ?? [], {
        coins: newCoins.toString(),
        daily_login_last_day: bonus.lastDay,
        daily_login_streak: bonus.streak.toString(),
      });

      const event = await publishEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content: prev?.content ?? '',
        tags: updatedTags,
        prev: prev ?? undefined,
      });

      updateProfileEvent(event);

      return {
        awarded: true,
        coinsAwarded: bonus.coinsAwarded,
        streak: bonus.streak,
      };
    },
    onSuccess: ({ awarded, coinsAwarded, streak }) => {
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user.pubkey] });
      }
      if (awarded) {
        toast({
          title: 'Daily Login Bonus!',
          description: `You received ${coinsAwarded} coins. Streak: ${streak} day${streak === 1 ? '' : 's'}.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Login Bonus Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Auto-claim once per session when a pubkey is available
  const claimedRef = useRef<Set<string>>(new Set());
  const claim = useCallback(() => {
    if (!user?.pubkey) return;
    if (claimedRef.current.has(user.pubkey)) return;
    claimedRef.current.add(user.pubkey);
    mutate.mutate();
  }, [user?.pubkey, mutate]);

  useEffect(() => {
    claim();
  }, [claim]);

  return mutate;
}
