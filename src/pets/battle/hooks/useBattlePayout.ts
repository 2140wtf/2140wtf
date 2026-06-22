import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';
import { fetchFreshPetsEvent } from '@/pets/core/lib/fetchFreshPetsEvent';
import { claimBaoSignetFaucet } from '@/lib/cashu/baoFaucet';
import type { CashuWalletState, CashuWalletActions } from '@/hooks/useCashuWallet';
import {
  KIND_BLOBBONAUT_PROFILE,
  parseBlobbonautEvent,
  updateBlobbonautTags,
  getLocalDayString,
} from '@/pets/core/lib/pets';
import { serializeProfileContent } from '@/pets/core/lib/missions';

export interface BattlePayoutRequest {
  /** Number of sats to award to the winner. */
  amount: number;
  /** 'demo-sats' awards profile sats; 'btc-sats' receives BAO signet/demo sats. */
  mode: 'demo-sats' | 'btc-sats';
}

export interface BattlePayoutResult {
  newSatsTotal: number;
  amountAwarded: number;
}

/**
 * Hook to pay out credits after a pet battle.
 *
 * - demo-sats: adds sats to the host's Blobbonaut profile.
 * - btc-sats: claims BAO signet/demo sats from the BAO faucet and deposits them
 *   into the user's BAO Cashu wallet (same seed/mint as bao.markets).
 *
 * A `battle_rewards_claimed_at` tag caps earnings to one payout per local day.
 */
export function useBattlePayout(
  updateProfileEvent: (event: NostrEvent) => void,
  externalWallet?: (CashuWalletState & CashuWalletActions) | null,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();

  return useMutation<BattlePayoutResult, Error, BattlePayoutRequest>({
    mutationFn: async ({ amount, mode }) => {
      if (!user?.pubkey) {
        throw new Error('You must be logged in to collect battle rewards.');
      }

      const prev = await fetchFreshPetsEvent(nostr, {
        kinds: [KIND_BLOBBONAUT_PROFILE],
        authors: [user.pubkey],
      });

      const profile = prev ? parseBlobbonautEvent(prev) : undefined;
      const today = getLocalDayString();

      // Daily cap: one battle prize per day.
      if (profile?.allTags.some((tag) => tag[0] === 'battle_rewards_claimed_at' && tag[1] === today)) {
        return {
          amountAwarded: 0,
          newSatsTotal: profile?.sats ?? 0,
        };
      }

      if (mode === 'btc-sats') {
        const faucetUrl = config.baoSignetFaucetUrl?.trim();
        if (!faucetUrl) {
          throw new Error('BAO faucet is not configured for real-sats payouts.');
        }
        if (!externalWallet) {
          throw new Error('BAO wallet is not available.');
        }

        const npub = nip19.npubEncode(user.pubkey);
        const result = await claimBaoSignetFaucet(faucetUrl, { npub, amount });
        if (!result?.token) {
          throw new Error(result?.message ?? 'BAO faucet did not return a token.');
        }
        await externalWallet.receiveToken(result.token.trim());

        // Record the daily claim on the profile (no demo-sats change).
        const tags = updateBlobbonautTags(prev?.tags ?? [], {
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

        return { amountAwarded: amount, newSatsTotal: profile?.sats ?? 0 };
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
    onSuccess: ({ amountAwarded, newSatsTotal }, { mode }) => {
      if (amountAwarded > 0) {
        const label = mode === 'btc-sats' ? 'BAO sats' : 'demo sats';
        toast({
          title: 'Battle reward claimed!',
          description: `You received ${amountAwarded.toLocaleString()} ${label}. Balance: ${newSatsTotal.toLocaleString()}.`,
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
