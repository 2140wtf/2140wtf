import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';
import { claimBaoSignetFaucet, clampBaoFaucetAmount, isBaoFaucetDailyExhausted } from '@/lib/cashu/baoFaucet';
import { decodeCashuToken } from '@/lib/cashu/cashu';
import type { CashuWalletState, CashuWalletActions } from '@/hooks/useCashuWallet';
import { updateNostrPetProfile } from '@/pets/core/lib/profile-sats';
import { serializeProfileContent } from '@/pets/core/lib/missions';

import { CHASE_FIAT_COST } from './types';

export interface ChasePayoutRequest {
  /** Number of demo sats won during the run. */
  satsWon: number;
  /** Number of fiat coins collected during the run. */
  coinsCollected: number;
  /** 'fiat' updates profile coins; 'sats' claims BAO demo sats and updates profile sats. */
  mode: 'fiat' | 'sats';
}

export interface ChasePayoutResult {
  newCoinsTotal: number;
  newSatsTotal: number;
  amountAwarded: number;
  claimedSats: number;
}

/**
 * Hook to settle Chase BTC run rewards.
 *
 * - fiat: deducts the run cost from in-game worthless coins.
 * - sats: claims BAO signet/demo sats from the faucet, deposits them into the BAO
 *   wallet. The in-game `sats` tag is NOT changed so real and demo balances cannot
 *   double-spend each other.
 */
export function useChasePayout(
  updateProfileEvent: (event: NostrEvent) => void,
  externalWallet?: (CashuWalletState & CashuWalletActions) | null,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();

  return useMutation<ChasePayoutResult, Error, ChasePayoutRequest>({
    mutationFn: async ({ satsWon, coinsCollected, mode }) => {
      if (!user?.pubkey) {
        throw new Error('You must be logged in to settle rewards.');
      }

      if (mode === 'sats') {
        const faucetUrl = config.baoSignetFaucetUrl?.trim();
        if (!faucetUrl) {
          throw new Error('BAO faucet is not configured for real-sats payouts.');
        }
        if (!externalWallet) {
          throw new Error('BAO wallet is not available.');
        }

        const npub = nip19.npubEncode(user.pubkey);
        const amount = Math.max(0, Math.floor(satsWon));
        const requestAmount = clampBaoFaucetAmount(amount);
        if (requestAmount <= 0) {
          throw new Error('BAO daily claim amount is too small or exhausted.');
        }

        const result = await claimBaoSignetFaucet(faucetUrl, { npub, amount: requestAmount });
        if (!result) {
          throw new Error('BAO faucet request failed.');
        }

        if (isBaoFaucetDailyExhausted(result)) {
          throw new Error(result.message ?? 'BAO 24h limit reached. Try again later.');
        }

        if (!result.token) {
          throw new Error(result.message ?? 'BAO faucet did not return a token.');
        }

        await externalWallet.receiveToken(result.token.trim());

        // Credit the profile ledger with the actual amount that arrived in the
        // wallet, not the faucet's `remaining24h` report, which can disagree.
        const decoded = decodeCashuToken(result.token.trim());
        const depositedSats = decoded?.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
        if (depositedSats <= 0) {
          throw new Error('BAO faucet returned an empty token.');
        }
        const claimedSats = clampBaoFaucetAmount(depositedSats, result.remaining24h);

        // Record the real-sats claim on the profile, but do not touch the demo
        // `sats` tag. This keeps the two economies separate.
        const resultMeta = await updateNostrPetProfile(nostr, publishEvent, user.pubkey, (freshProfile, prevTags, prevContent) => {
          const newSatsTotal = freshProfile?.sats ?? 0;
          const content = serializeProfileContent(prevContent, {});
          return { tags: prevTags, content, meta: { newSatsTotal, claimedSats } };
        });

        if (resultMeta?.event) {
          updateProfileEvent(resultMeta.event);
        }

        return {
          newCoinsTotal: resultMeta?.profile?.coins ?? 0,
          newSatsTotal: resultMeta?.meta?.newSatsTotal as number,
          amountAwarded: claimedSats,
          claimedSats,
        };
      }

      // Fiat mode: deduct the run cost from in-game worthless coins.
      const resultMeta = await updateNostrPetProfile(nostr, publishEvent, user.pubkey, (freshProfile, prevTags, prevContent) => {
        const currentCoins = freshProfile?.coins ?? 0;
        if (currentCoins < CHASE_FIAT_COST) {
          throw new Error(
            `Insufficient coins. You need ${CHASE_FIAT_COST} coins but only have ${currentCoins.toLocaleString()}.`
          );
        }
        const newCoinsTotal = currentCoins - CHASE_FIAT_COST;
        const content = serializeProfileContent(prevContent, {});
        return {
          tags: freshProfile?.event.tags ?? prevTags,
          content,
          meta: { newCoinsTotal, amountAwarded: Math.max(0, coinsCollected) },
        };
      });

      if (!resultMeta) {
        throw new Error('Profile update returned no changes.');
      }

      if (resultMeta.event) {
        updateProfileEvent(resultMeta.event);
      }

      return {
        newCoinsTotal: resultMeta.meta?.newCoinsTotal as number,
        newSatsTotal: resultMeta.profile?.sats ?? 0,
        amountAwarded: (resultMeta.meta?.amountAwarded as number) ?? Math.max(0, coinsCollected),
        claimedSats: 0,
      };
    },
    onSuccess: ({ claimedSats, newCoinsTotal, newSatsTotal }, { mode }) => {
      if (mode === 'sats' && claimedSats > 0) {
        toast({
          title: '₿AO sats claimed!',
          description: `Received ${claimedSats.toLocaleString()} ₿AO sats. Balance: ${newSatsTotal.toLocaleString()}.`,
        });
      } else if (mode === 'fiat') {
        toast({
          title: 'Run settled',
          description: `Coins balance: ${newCoinsTotal.toLocaleString()}.`,
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
