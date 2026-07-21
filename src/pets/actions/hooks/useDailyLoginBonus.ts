/**
 * useDailyLoginBonus - Award a daily login sats bonus
 *
 * Checks the Nostr pet profile once per session and, if the user hasn't
 * received a login bonus today, awards demo sats and updates the profile.
 */

import { useCallback, useEffect, useRef } from 'react';
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
import { calculateDailyLoginBonus } from '../lib/daily-login-bonus';

export interface DailyLoginBonusResult {
  awarded: boolean;
  satsAwarded: number;
  streak: number;
}

/**
 * Hook to claim the daily login sats bonus.
 *
 * @param updateProfileEvent - Callback to update profile in query cache
 */
export function useDailyLoginBonus(
  updateProfileEvent: (event: import('@nostrify/nostrify').NostrEvent) => void,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const queryClient = useQueryClient();

  const mutate = useMutation({
    mutationFn: async (): Promise<DailyLoginBonusResult> => {
      if (!user?.pubkey) throw new Error('Must be logged in');

      const prev = await fetchFreshPetsEvent(nostr, {
        kinds: [KIND_NOSTR_PET_PROFILE],
        authors: [user.pubkey],
      });

      if (!prev) {
        return { awarded: false, satsAwarded: 0, streak: 0 };
      }

      const freshProfile = parseNostrPetProfileEvent(prev);
      if (!freshProfile) {
        return { awarded: false, satsAwarded: 0, streak: 0 };
      }

      const bonus = calculateDailyLoginBonus(
        freshProfile.dailyLoginLastDay,
        freshProfile.dailyLoginStreak ?? 0,
      );

      if (!bonus.awarded) {
        return { awarded: false, satsAwarded: 0, streak: bonus.streak };
      }

      const currentSats = freshProfile.sats;
      const newSats = currentSats + bonus.satsAwarded;

      const updatedTags = updateNostrPetProfileTags(prev?.tags ?? [], {
        sats: newSats.toString(),
        daily_login_last_day: bonus.lastDay,
        daily_login_streak: bonus.streak.toString(),
      });

      const event = await publishEvent({
        kind: KIND_NOSTR_PET_PROFILE,
        content: prev?.content ?? '',
        tags: updatedTags,
        prev: prev ?? undefined,
      });

      updateProfileEvent(event);

      return {
        awarded: true,
        satsAwarded: bonus.satsAwarded,
        streak: bonus.streak,
      };
    },
    onSuccess: ({ awarded, satsAwarded, streak }) => {
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['nostr-pet-profile', user.pubkey] });
      }
      if (awarded) {
        toast({
          title: 'Daily Login Bonus!',
          description: `You received ${satsAwarded.toLocaleString()} demo sats. Streak: ${streak} day${streak === 1 ? '' : 's'}.`,
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
