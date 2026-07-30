import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { KIND_PETS_STATE, updateNostrPetProfileTags, updatePetsTags } from '@/pets/core/lib/pets';
import type { PetsCompanion } from '@/pets/core/lib/pets';
import { serializeProfileContent } from '@/pets/core/lib/missions';
import { PET_FIAT_RESERVE_SATS } from '@/pets/shop/hooks/usePetsPurchaseItem';

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
 * - fiat: deducts the run cost from starter currency — the pet-bound fiat
 *   pot first (down to the reserve), then the account coins pot — and
 *   credits the coins collected during the run.
 * - sats: claims BAO signet/demo sats from the faucet, deposits them into the BAO
 *   wallet. The in-game `sats` tag is NOT changed so real and demo balances cannot
 *   double-spend each other.
 */
export function useChasePayout(
  updateProfileEvent: (event: NostrEvent) => void,
  externalWallet?: (CashuWalletState & CashuWalletActions) | null,
  companion?: PetsCompanion | null,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const queryClient = useQueryClient();

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

        // A claim that exactly exhausts the 24h budget returns a valid token
        // AND remaining24h: 0 — the token must still be redeemed. Only treat
        // "exhausted" as an error when the faucet issued NO token; throwing
        // here with a token in hand would discard a claim the faucet already
        // debited, and it can never be re-claimed.
        if (!result.token) {
          throw new Error(
            result.message ??
              (isBaoFaucetDailyExhausted(result)
                ? 'BAO 24h limit reached. Try again later.'
                : 'BAO faucet did not return a token.'),
          );
        }

        // The faucet has already counted this claim against the daily limit.
        // The wallet journals failed receives (pending-receive entries) and
        // retries them automatically, so a transient mint/network failure here
        // does not lose the sats — tell the user that instead of a bare
        // "claim failed" that invites a second faucet attempt.
        try {
          await externalWallet.receiveToken(result.token.trim());
        } catch (receiveErr) {
          const detail = receiveErr instanceof Error ? receiveErr.message : String(receiveErr);
          throw new Error(
            `The faucet issued your token, but the wallet could not redeem it yet (${detail}). It will keep retrying in the background — do not claim again.`,
          );
        }

        // Credit the profile ledger with the actual amount that arrived in the
        // wallet, not the faucet's `remaining24h` report, which can disagree.
        const decoded = decodeCashuToken(result.token.trim());
        const depositedSats = decoded?.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
        if (depositedSats <= 0) {
          throw new Error('BAO faucet returned an empty token.');
        }
        // Clamp only to the per-claim ceiling: remaining24h is the allowance
        // AFTER this claim, so it is 0 exactly when the claim exhausted the
        // budget — clamping by it would zero out sats that actually arrived.
        const claimedSats = clampBaoFaucetAmount(depositedSats);

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

      // Fiat mode: deduct the run cost from starter currency — pet-bound fiat
      // first (down to the reserve), then account coins — and credit the coins
      // collected during the run. The tag list must be UPDATED with the new
      // balance — returning the unmodified tags (the old bug) made the settle
      // a silent no-op: runs were free and winnings vanished.
      const petFiatBalance = companion?.fiatBalance ?? 0;
      const petFiatSpend = petFiatBalance >= PET_FIAT_RESERVE_SATS
        ? Math.min(CHASE_FIAT_COST, petFiatBalance - PET_FIAT_RESERVE_SATS)
        : 0;
      const coinsSpend = CHASE_FIAT_COST - petFiatSpend;

      // Publish the pet-fiat deduction first (different kind than the
      // profile), rolling it back if the profile update fails — same
      // two-event dance as the shop purchase flow.
      let companionEvent: NostrEvent | undefined;
      if (petFiatSpend > 0 && companion) {
        const petTags = updatePetsTags(companion.event.tags, {
          fiat_balance: Math.max(0, companion.fiatBalance - petFiatSpend).toString(),
        });
        companionEvent = await publishEvent({
          kind: KIND_PETS_STATE,
          content: companion.event.content,
          tags: petTags,
        });
      }

      let resultMeta;
      try {
        resultMeta = await updateNostrPetProfile(nostr, publishEvent, user.pubkey, (freshProfile, prevTags, prevContent) => {
          const currentCoins = freshProfile?.coins ?? 0;
          if (currentCoins < coinsSpend) {
            throw new Error(
              `Insufficient starter currency. You need ${coinsSpend} coins but only have ${currentCoins.toLocaleString()}.`
            );
          }
          const winnings = Math.max(0, coinsCollected);
          const newCoinsTotal = currentCoins - coinsSpend + winnings;
          const content = serializeProfileContent(prevContent, {});
          return {
            tags: updateNostrPetProfileTags(freshProfile?.event.tags ?? prevTags, { coins: String(newCoinsTotal) }),
            content,
            meta: { newCoinsTotal, amountAwarded: winnings },
          };
        });
      } catch (profileError) {
        if (companionEvent && companion && petFiatSpend > 0) {
          try {
            const rollbackTags = updatePetsTags(companionEvent.tags, {
              fiat_balance: companion.fiatBalance.toString(),
            });
            await publishEvent({
              kind: KIND_PETS_STATE,
              content: companion.event.content,
              tags: rollbackTags,
              prev: companionEvent,
            });
          } catch (rollbackError) {
            console.error('[useChasePayout] Failed to restore pet fiat balance after profile update failure:', rollbackError);
          }
        }
        throw profileError;
      }

      if (companionEvent) {
        queryClient.invalidateQueries({ queryKey: ['pets-collection', user.pubkey] });
      }

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
