import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { useExternalSatsPayment } from '@/pets/core/hooks/useExternalSatsPayment';
import { fetchFreshPetsEvent } from '@/pets/core/lib/fetchFreshPetsEvent';
import { toast } from '@/hooks/useToast';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';

import type { PurchaseRequest } from '../types/shop.types';
import type { BlobbonautProfile, StorageItem } from '@/pets/core/lib/pets';
import {
  KIND_BLOBBONAUT_PROFILE,
  updateBlobbonautTags,
  createStorageTags,
} from '@/pets/core/lib/pets';
import { getShopItemById } from '../lib/pets-shop-items';

/**
 * Hook to purchase items from the Pets Shop.
 *
 * Handles:
 * - Demo-sats deduction from the profile `sats` tag (wallet_mode === 'demo-sats')
 * - Real BTC sats payment via the external Cashu wallet (wallet_mode === 'btc-sats')
 * - Storage updates (stacking or adding new items)
 * - Atomic profile update
 */
export function usePetsPurchaseItem(
  currentProfile: BlobbonautProfile | null,
  externalWallet?: (CashuWalletState & CashuWalletActions) | null,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const { paySats } = useExternalSatsPayment(externalWallet);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, price, quantity }: PurchaseRequest) => {
      if (!user?.pubkey) {
        throw new Error('You must be logged in to purchase items');
      }

      if (!currentProfile) {
        throw new Error('Profile not found');
      }

      // Validate item exists in catalog
      const item = getShopItemById(itemId);
      if (!item) {
        throw new Error('Item not found in shop catalog');
      }

      // Validate price matches one of the accepted currency prices.
      const fiatPrice = item.fiatPrice ?? item.price;
      const satsPrice = item.satsPrice ?? item.price;
      const isValidPrice = price === fiatPrice || price === satsPrice;
      if (!isValidPrice) {
        throw new Error('Item price mismatch. Please refresh and try again.');
      }

      const isBtcSats = currentProfile.walletMode === 'btc-sats';
      const totalFiatCost = fiatPrice * quantity;
      const totalSatsCost = satsPrice * quantity;

      // Prefer fake fiat coins first; they can only decrease and never be replenished.
      // In demo-sats mode fall back to profile demo sats; in btc-sats mode pay the
      // external BAO wallet.
      let currency: 'fiat coins' | 'demo sats' | 'sats' = 'fiat coins';
      if (currentProfile.coins >= totalFiatCost) {
        if (currentProfile.coins - totalFiatCost < 0) {
          throw new Error('Fiat coins cannot go below zero.');
        }
      } else if (isBtcSats) {
        if (!externalWallet || externalWallet.totalBalance < totalSatsCost) {
          throw new Error(
            `Insufficient external wallet balance. You need ${totalSatsCost.toLocaleString()} sats but only have ${externalWallet?.totalBalance?.toLocaleString() ?? 0}.`
          );
        }
        await paySats(totalSatsCost, `Pets shop: ${item.name}`);
        currency = 'sats';
      } else if (currentProfile.sats >= totalSatsCost) {
        currency = 'demo sats';
      } else {
        throw new Error(
          `Insufficient funds. You need ${totalFiatCost.toLocaleString()} fiat coins (or ${totalSatsCost.toLocaleString()} demo sats) but have ${currentProfile.coins.toLocaleString()} fiat coins and ${currentProfile.sats.toLocaleString()} demo sats.`
        );
      }

      // Update storage (stack or add)
      const existingIndex = currentProfile.storage.findIndex(s => s.itemId === itemId);
      let newStorage: StorageItem[];

      if (existingIndex >= 0) {
        // Stack: increase quantity of existing item
        newStorage = [...currentProfile.storage];
        newStorage[existingIndex] = {
          ...newStorage[existingIndex],
          quantity: newStorage[existingIndex].quantity + quantity,
        };
      } else {
        // Add: append new item to storage
        newStorage = [...currentProfile.storage, { itemId, quantity }];
      }

      // Build updated tags
      // createStorageTags returns [['storage', 'itemId:quantity'], ...], we need just the values
      const storageValues = createStorageTags(newStorage).map(tag => tag[1]);

      // Fetch fresh profile from relays to avoid stale-read overwrites
      const prev = await fetchFreshPetsEvent(nostr, {
        kinds: [KIND_BLOBBONAUT_PROFILE],
        authors: [user.pubkey],
      });
      if (!prev) {
        throw new Error('Profile not found on relays');
      }

      const updates: Record<string, string | string[]> = {
        storage: storageValues, // Array of 'itemId:quantity' strings
      };
      if (currency === 'fiat coins') {
        updates.coins = (currentProfile.coins - totalFiatCost).toString();
      } else if (currency === 'demo sats') {
        updates.sats = (currentProfile.sats - totalSatsCost).toString();
      }

      const updatedTags = updateBlobbonautTags(prev.tags, updates);

      // Publish updated profile event
      const event = await publishEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content: prev.content,
        tags: updatedTags,
        prev,
      });

      return { event, item, quantity, totalCost: currency === 'fiat coins' ? totalFiatCost : totalSatsCost, currency };
    },
    onSuccess: ({ item, quantity, totalCost, currency }) => {
      // Invalidate profile query to refetch fresh data
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user.pubkey] });
      }

      // Show success toast
      toast({
        title: 'Purchase Successful!',
        description: `You bought ${item.name} (×${quantity}) for ${totalCost.toLocaleString()} ${currency}.`,
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
