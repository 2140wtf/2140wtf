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
import { getLocalDayString, updateNostrPetProfileTags } from '@/pets/core/lib/pets';

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
 * - demo-sats: adds sats to the host's Nostr pet profile.
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

      if (mode === 'btc-sats') {
        const faucetUrl = config.baoSignetFaucetUrl?.trim();
        if (!faucetUrl) {
          throw new Error('₿AO faucet is not configured for real-sats payouts.');
        }
        if (!externalWallet) {
          throw new Error('₿AO wallet is not available.');
        }

        // Check the daily cap and claim the faucet inside the serialized profile
        // updater so concurrent callers cannot claim twice before the tag is set.
        const updateResult = await updateNostrPetProfile(
          nostr,
          publishEvent,
          user.pubkey,
          async (freshProfile, prevTags, prevContent) => {
            const today = getLocalDayString();
            if (
              freshProfile?.allTags.some(
                (tag) => tag[0] === 'battle_rewards_claimed_at' && tag[1] === today
              )
            ) {
              return {
                tags: prevTags,
                content: serializeProfileContent(prevContent, {}),
                meta: { alreadyClaimed: true, newSatsTotal: freshProfile.sats },
              };
            }

            const npub = nip19.npubEncode(user.pubkey);
            const requestAmount = clampBaoFaucetAmount(amount);
            if (requestAmount <= 0) {
              throw new Error('₿AO daily claim amount is too small or exhausted.');
            }
            const result = await claimBaoSignetFaucet(faucetUrl, { npub, amount: requestAmount });
            // A claim that exactly exhausts the 24h budget returns a valid
            // token AND remaining24h: 0 — the token must still be redeemed.
            // Only treat "exhausted" as an error when the faucet issued NO
            // token; throwing with a token in hand would discard a claim the
            // faucet already debited, and it can never be re-claimed.
            if (!result?.token) {
              throw new Error(result?.message ?? (result && isBaoFaucetDailyExhausted(result)
                ? '₿AO 24h limit reached. Try again later.'
                : '₿AO faucet did not return a token.'));
            }

            // receiveToken never throws (returns 0 on failure) and journals
            // the token for automatic background retries — but a 0 means the
            // sats have NOT arrived, so the profile must not be credited with
            // the token's face value.
            const received = await externalWallet.receiveToken(result.token.trim());
            if (received <= 0) {
              throw new Error('The faucet issued your token, but the wallet could not redeem it yet — it is journaled and retries automatically in the background. Do not claim again.');
            }

            // Credit the actual token amount, capping only to the per-claim
            // ceiling: remaining24h is the allowance AFTER this claim, so it
            // is 0 exactly when the claim exhausted the budget — clamping by
            // it would zero out sats that actually arrived.
            const decoded = decodeCashuToken(result.token.trim());
            const depositedSats = decoded?.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
            const claimedSats = clampBaoFaucetAmount(depositedSats);
            if (claimedSats <= 0) {
              throw new Error('₿AO faucet returned an empty token.');
            }

            const tags = updateNostrPetProfileTags(freshProfile?.event.tags ?? prevTags, {
              battle_rewards_claimed_at: today,
            });
            return {
              tags,
              content: serializeProfileContent(prevContent, {}),
              meta: { amountAwarded: claimedSats, newSatsTotal: freshProfile?.sats ?? 0 },
            };
          }
        );

        if (updateResult?.event) {
          updateProfileEvent(updateResult.event);
        }

        const alreadyClaimed = updateResult?.meta?.alreadyClaimed as boolean | undefined;
        const amountAwarded = (updateResult?.meta?.amountAwarded as number | undefined) ?? 0;
        const newSatsTotal =
          (updateResult?.meta?.newSatsTotal as number | undefined) ??
          (updateResult?.profile?.sats ?? 0);
        return { amountAwarded: alreadyClaimed ? 0 : amountAwarded, newSatsTotal };
      }

      // Demo-sats mode: add to the in-game profile balance under the serialized
      // update helper so concurrent rewards cannot double-spend.
      const updateResult = await updateNostrPetProfile(nostr, publishEvent, user.pubkey, (freshProfile, prevTags, prevContent) => {
        const today = getLocalDayString();
        if (freshProfile?.allTags.some((tag) => tag[0] === 'battle_rewards_claimed_at' && tag[1] === today)) {
          return { tags: prevTags, content: serializeProfileContent(prevContent, {}), meta: { alreadyClaimed: true, newSatsTotal: freshProfile?.sats ?? 0 } };
        }

        const currentSats = freshProfile?.sats ?? 0;
        const newSatsTotal = currentSats + amount;
        const tags = updateNostrPetProfileTags(freshProfile?.event.tags ?? prevTags, {
          sats: newSatsTotal.toString(),
          battle_rewards_claimed_at: today,
        });
        return { tags, content: serializeProfileContent(prevContent, {}), meta: { newSatsTotal } };
      });

      if (!updateResult) {
        throw new Error('Profile update returned no changes.');
      }

      if (updateResult.event) {
        updateProfileEvent(updateResult.event);
      }

      const alreadyClaimed = updateResult.meta?.alreadyClaimed as boolean | undefined;
      const newSatsTotal = (updateResult.meta?.newSatsTotal as number | undefined) ?? (updateResult.profile?.sats ?? 0);
      return { amountAwarded: alreadyClaimed ? 0 : amount, newSatsTotal };
    },
    onSuccess: ({ amountAwarded, newSatsTotal }, { mode }) => {
      if (amountAwarded > 0) {
        const label = mode === 'btc-sats' ? '₿AO sats' : 'demo sats';
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
