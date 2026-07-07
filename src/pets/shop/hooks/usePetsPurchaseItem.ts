import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { useExternalSatsPayment } from '@/pets/core/hooks/useExternalSatsPayment';
import { toast } from '@/hooks/useToast';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';
import { updateBlobbonautProfile } from '@/pets/core/lib/profile-sats';
import type { NostrEvent } from '@nostrify/nostrify';

import type { CashuWallet, MintKeyset } from '@cashu/cashu-ts';

import type { PurchaseRequest } from '../types/shop.types';
import type { BlobbonautProfile, PetsCompanion, StorageItem } from '@/pets/core/lib/pets';
import {
  KIND_PETS_STATE,
  updateBlobbonautTags,
  createStorageTags,
  updatePetsTags,
} from '@/pets/core/lib/pets';
import { getShopItemById } from '../lib/pets-shop-items';

function getSelectedMintBalance(wallet?: (CashuWalletState & CashuWalletActions) | null): number {
  if (!wallet?.mintUrl) return 0;
  return wallet.balances?.[wallet.mintUrl] ?? 0;
}

/**
 * Estimate the Cashu mint fee for sending a given amount of sats from the
 * active keyset. The real fee depends on the actual proofs selected, so this
 * returns a conservative reserve based on the active keyset's input_fee_ppk.
 * A small buffer is added so the UI does not advertise an item as affordable
 * when the wallet would fail due to rounding or a minimal fee.
 */
export function estimateCashuSendFee(amount: number, wallet: CashuWallet | null): number {
  if (!wallet || amount <= 0) return 0;
  try {
    const activeKeyset = wallet.keysets.find((k: MintKeyset) => k.id === wallet.keysetId);
    const ppk = activeKeyset?.input_fee_ppk ?? 0;
    return Math.max(1, Math.ceil((amount * ppk) / 1000) + 1);
  } catch {
    // If keysets are unavailable, reserve 1% as a safe fallback.
    return Math.max(1, Math.ceil(amount * 0.01));
  }
}

/** Minimum pet-bound fiat balance to keep as a reserve before falling back to wallet rails. */
const PET_FIAT_RESERVE_SATS = 100;

/**
 * Compute how much of a sats-priced purchase should be covered by the pet's
 * bound fiat balance vs the wallet. The pet always spends first, but we leave
 * a small reserve so the pet is not emptied to zero.
 */
function splitSatsPayment(
  totalSatsCost: number,
  petFiatBalance: number,
): { petFiatSpend: number; walletSatsCost: number } {
  if (totalSatsCost <= 0) return { petFiatSpend: 0, walletSatsCost: 0 };
  if (petFiatBalance <= 0) return { petFiatSpend: 0, walletSatsCost: totalSatsCost };

  // If the pet can pay the whole cost and still keep the reserve, use pet fiat only.
  if (petFiatBalance >= totalSatsCost + PET_FIAT_RESERVE_SATS) {
    return { petFiatSpend: totalSatsCost, walletSatsCost: 0 };
  }

  // If the pet balance itself is below the reserve, do not touch it; fall back to wallet.
  if (petFiatBalance < PET_FIAT_RESERVE_SATS) {
    return { petFiatSpend: 0, walletSatsCost: totalSatsCost };
  }

  // Spend pet fiat down to the reserve, cover the rest with the wallet.
  const petFiatSpend = petFiatBalance - PET_FIAT_RESERVE_SATS;
  return { petFiatSpend, walletSatsCost: totalSatsCost - petFiatSpend };
}

/**
 * Hook to purchase items from the Pets Shop.
 *
 * Handles:
 * - Pet-bound fiat balance first for sats-priced items
 * - Real BTC sats payment via the external Cashu wallet (wallet_mode === 'btc-sats')
 * - Demo-sats deduction from the profile `sats` tag (wallet_mode === 'demo-sats')
 * - Storage updates (stacking or adding new items)
 * - Atomic profile update
 */
export function usePetsPurchaseItem(
  currentProfile: BlobbonautProfile | null,
  companion?: PetsCompanion | null,
  externalWallet?: (CashuWalletState & CashuWalletActions) | null,
  onCompanionUpdated?: (event: NostrEvent) => void,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const { paySats } = useExternalSatsPayment(externalWallet);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, price, quantity, currency: requestedCurrency }: PurchaseRequest) => {
      if (!user?.pubkey) {
        throw new Error('You must be logged in to purchase items');
      }

      if (!currentProfile) {
        throw new Error('Profile not found');
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('Invalid quantity. Quantity must be a positive whole number.');
      }

      // Validate item exists in catalog
      const item = getShopItemById(itemId);
      if (!item) {
        throw new Error('Item not found in shop catalog');
      }

      if (item.status !== 'live') {
        throw new Error('This item is not currently available for purchase.');
      }

      const fiatPrice = item.fiatPrice ?? item.price;
      const satsPrice = item.satsPrice ?? item.price;
      const totalFiatCost = fiatPrice * quantity;
      const totalSatsCost = satsPrice * quantity;

      // Use the current profile for initial wallet-mode decisions; the serialized
      // update below re-reads the freshest profile before publishing.
      const isBtcSats = currentProfile.walletMode === 'btc-sats';

      // Determine the intended currency from the explicit request or the price.
      // Reject mismatched price/currency pairs so the button price always
      // matches the currency actually deducted.
      let resolvedCurrency: 'fiat' | 'sats';
      if (requestedCurrency) {
        if (requestedCurrency === 'fiat' && price === fiatPrice) {
          resolvedCurrency = 'fiat';
        } else if (requestedCurrency === 'sats' && price === satsPrice) {
          resolvedCurrency = 'sats';
        } else {
          throw new Error('Item price and currency do not match. Please refresh and try again.');
        }
      } else {
        // For real-sats wallets default to sats when a price is ambiguous;
        // otherwise prefer the in-game fiat coin price.
        if (isBtcSats) {
          if (price === satsPrice) {
            resolvedCurrency = 'sats';
          } else if (price === fiatPrice) {
            resolvedCurrency = 'fiat';
          } else {
            throw new Error('Item price mismatch. Please refresh and try again.');
          }
        } else {
          if (price === fiatPrice) {
            resolvedCurrency = 'fiat';
          } else if (price === satsPrice) {
            resolvedCurrency = 'sats';
          } else {
            throw new Error('Item price mismatch. Please refresh and try again.');
          }
        }
      }

      let currency: 'fiat coins' | 'demo sats' | 'sats' = 'fiat coins';
      let totalCost = 0;
      let paymentToken: string | undefined;
      let petFiatSpend = 0;
      let walletSatsCost = 0;

      if (resolvedCurrency === 'sats') {
        currency = isBtcSats ? 'sats' : 'demo sats';
        totalCost = totalSatsCost;

        // Split the cost between pet-bound fiat and the wallet.
        const split = splitSatsPayment(totalSatsCost, companion?.fiatBalance ?? 0);
        petFiatSpend = split.petFiatSpend;
        walletSatsCost = split.walletSatsCost;

        if (walletSatsCost > 0 && isBtcSats) {
          if (!externalWallet) {
            throw new Error('External wallet is not available.');
          }
          const selectedMintBalance = getSelectedMintBalance(externalWallet);
          const feeReserve = estimateCashuSendFee(walletSatsCost, externalWallet.wallet ?? null);
          const totalNeeded = walletSatsCost + feeReserve;
          if (selectedMintBalance < totalNeeded) {
            throw new Error(
              `Insufficient balance on the selected mint. You need ${walletSatsCost.toLocaleString()} sats + ~${feeReserve.toLocaleString()} sats fee (${totalNeeded.toLocaleString()} total) but only have ${selectedMintBalance.toLocaleString()} sats on ${externalWallet.mintUrl ?? 'the selected mint'}.`
            );
          }
          // Burn real sats BEFORE updating the profile so a payment failure cannot
          // grant a free item. If the profile update fails after the token is spent,
          // attempt to refund the token so the user does not lose sats.
          paymentToken = await paySats(walletSatsCost, `Pets shop: ${item.name}`);
        }
      } else {
        currency = 'fiat coins';
        totalCost = totalFiatCost;
      }

      // If pet-bound fiat is being spent, publish the companion update first.
      // This happens outside the profile serialization because it is a different
      // kind (31124 vs 11125), but it is idempotent: a failure here stops the
      // purchase before any wallet money moves.
      let companionEvent: NostrEvent | undefined;
      if (petFiatSpend > 0 && companion) {
        const newFiatBalance = Math.max(0, companion.fiatBalance - petFiatSpend);
        const petTags = updatePetsTags(companion.event.tags, {
          fiat_balance: newFiatBalance.toString(),
        });
        companionEvent = await publishEvent({
          kind: KIND_PETS_STATE,
          content: companion.event.content,
          tags: petTags,
        });
      }

      // Serialize the profile update so concurrent purchases/missions cannot
      // overwrite each other and double-spend in-game currency. The wallet mode
      // used for deductions is pinned to the mode at the time the user clicked
      // buy; if it changed between the UI render and the serialized update we
      // still honor the real-sats payment that was already made and do not
      // double-charge (or grant a free item) by re-deriving the currency.
      let result;
      try {
        result = await updateBlobbonautProfile(nostr, publishEvent, user.pubkey, (freshProfile) => {
          if (!freshProfile) {
            throw new Error('Profile not found on relays');
          }

          if (resolvedCurrency === 'fiat') {
            if (freshProfile.coins < totalFiatCost) {
              throw new Error(
                `Insufficient fiat coins. You need ${totalFiatCost.toLocaleString()} but have ${freshProfile.coins.toLocaleString()}.`
              );
            }
          } else if (!isBtcSats) {
            // Demo-sats purchase: the external wallet was not charged, so deduct the
            // remaining cost from the freshest profile demo sats balance.
            const demoDeduction = resolvedCurrency === 'sats' ? walletSatsCost : totalSatsCost;
            if (freshProfile.sats < demoDeduction) {
              throw new Error(
                `Insufficient demo sats. You need ${demoDeduction.toLocaleString()} but have ${freshProfile.sats.toLocaleString()}.`
              );
            }
          }

          // Recompute the purchase deltas from the fresh profile so concurrent
          // updates on other devices are not silently overwritten.
          const existingIndex = freshProfile.storage.findIndex((s) => s.itemId === itemId);
          let newStorage: StorageItem[];

          if (existingIndex >= 0) {
            // Stack: increase quantity of existing item
            newStorage = [...freshProfile.storage];
            newStorage[existingIndex] = {
              ...newStorage[existingIndex],
              quantity: newStorage[existingIndex].quantity + quantity,
            };
          } else {
            // Add: append new item to storage
            newStorage = [...freshProfile.storage, { itemId, quantity }];
          }

          // Build updated tags
          // createStorageTags returns [['storage', 'itemId:quantity'], ...], we need just the values
          const storageValues = createStorageTags(newStorage).map((tag) => tag[1]);

          const updates: Record<string, string | string[]> = {
            storage: storageValues,
          };
          if (resolvedCurrency === 'fiat') {
            updates.coins = (freshProfile.coins - totalFiatCost).toString();
          } else if (!isBtcSats) {
            const demoDeduction = resolvedCurrency === 'sats' ? walletSatsCost : totalSatsCost;
            updates.sats = (freshProfile.sats - demoDeduction).toString();
          }

          const tags = updateBlobbonautTags(freshProfile.event.tags, updates);
          return { tags, content: freshProfile.event.content, meta: { currency, totalCost, petFiatSpend } };
        });
      } catch (profileError) {
        if (paymentToken && externalWallet) {
          try {
            await externalWallet.receiveToken(paymentToken);
            console.warn('[usePetsPurchaseItem] Refunded Cashu token after profile update failure:', profileError);
          } catch (refundError) {
            const refundMessage = refundError instanceof Error ? refundError.message : 'unknown error';
            console.error('[usePetsPurchaseItem] Failed to refund Cashu token after profile update failure:', refundError);
            throw new Error(
              `Profile update failed and the Cashu refund could not be completed (${refundMessage}). ` +
                `Save this token if possible: ${paymentToken.slice(0, 40)}...`,
            );
          }
        }
        throw profileError;
      }

      if (!result) {
        throw new Error('Profile update returned no changes.');
      }

      // Notify the caller about the updated companion so the UI can optimistically
      // refresh the pet's fiat balance.
      if (companionEvent) {
        onCompanionUpdated?.(companionEvent);
      }

      return {
        event: result.event,
        item,
        quantity,
        totalCost: (result.meta?.totalCost as number | undefined) ?? totalCost,
        currency: (result.meta?.currency as typeof currency | undefined) ?? currency,
        paymentToken,
        petFiatSpend: (result.meta?.petFiatSpend as number | undefined) ?? 0,
      };
    },
    onSuccess: ({ item, quantity, totalCost, currency, petFiatSpend }) => {
      // Invalidate profile query to refetch fresh data
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user.pubkey] });
      }

      // Show success toast
      const petPart = petFiatSpend > 0 ? ` (${petFiatSpend.toLocaleString()} from pet fiat)` : '';
      toast({
        title: 'Purchase Successful!',
        description: `You bought ${item.name} (×${quantity}) for ${totalCost.toLocaleString()} ${currency}.${petPart}`,
      });
    },
    onError: (error: Error) => {
      // Show error toast
      toast({
        title: 'Purchase Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
