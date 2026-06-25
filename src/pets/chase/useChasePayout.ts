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
} from '@/pets/core/lib/pets';
import { serializeProfileContent } from '@/pets/core/lib/missions';

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
 * - fiat: deducts the run cost and adds collected worthless coins back to the profile.
 * - sats: claims BAO signet/demo sats from the faucet, deposits them into the BAO
 *   wallet, and updates the profile sats balance.
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

      const prev = await fetchFreshPetsEvent(nostr, {
        kinds: [KIND_BLOBBONAUT_PROFILE],
        authors: [user.pubkey],
      });

      const profile = prev ? parseBlobbonautEvent(prev) : undefined;

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
        let claimedSats = amount;

        const result = await claimBaoSignetFaucet(faucetUrl, { npub, amount });
        if (!result) {
          throw new Error('BAO faucet request failed.');
        }

        if (result.remaining24h !== undefined && result.remaining24h < amount) {
          claimedSats = Math.max(0, Math.floor(result.remaining24h));
        }

        if (claimedSats <= 0) {
          throw new Error(result.message ?? 'BAO 24h limit reached. Try again later.');
        }

        if (!result.token) {
          throw new Error(result.message ?? 'BAO faucet did not return a token.');
        }

        await externalWallet.receiveToken(result.token.trim());

        const currentSats = profile?.sats ?? 0;
        const newSatsTotal = currentSats + claimedSats;
        const tags = updateBlobbonautTags(prev?.tags ?? [], {
          sats: newSatsTotal.toString(),
        });
        const content = serializeProfileContent(prev?.content ?? '', {});
        const event = await publishEvent({
          kind: KIND_BLOBBONAUT_PROFILE,
          content,
          tags,
          prev: prev ?? undefined,
        });
        updateProfileEvent(event);

        return {
          newCoinsTotal: profile?.coins ?? 0,
          newSatsTotal,
          amountAwarded: claimedSats,
          claimedSats,
        };
      }

      // Fiat mode: cost 100 coins, add collected coins back as score currency.
      const currentCoins = profile?.coins ?? 0;
      const newCoinsTotal = currentCoins - 100 + Math.max(0, coinsCollected);
      const tags = updateBlobbonautTags(prev?.tags ?? [], {
        coins: newCoinsTotal.toString(),
      });
      const content = serializeProfileContent(prev?.content ?? '', {});
      const event = await publishEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content,
        tags,
        prev: prev ?? undefined,
      });
      updateProfileEvent(event);

      return {
        newCoinsTotal,
        newSatsTotal: profile?.sats ?? 0,
        amountAwarded: Math.max(0, coinsCollected),
        claimedSats: 0,
      };
    },
    onSuccess: ({ claimedSats, newCoinsTotal, newSatsTotal }, { mode }) => {
      if (mode === 'sats' && claimedSats > 0) {
        toast({
          title: 'BAO sats claimed!',
          description: `Received ${claimedSats.toLocaleString()} demo sats. Balance: ${newSatsTotal.toLocaleString()}.`,
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
