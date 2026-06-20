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

/** Demo-sats are priced at 100× the base catalog price so whole numbers feel substantial. */
export const DEMO_SATS_PRICE_MULTIPLIER = 100;

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

      // Validate price matches catalog (prevent client tampering)
      if (item.price !== price) {
        throw new Error('Item price mismatch. Please refresh and try again.');
      }

      const isDemoSats = currentProfile.walletMode === 'demo-sats';
      const isBtcSats = currentProfile.walletMode === 'btc-sats';

      // Calculate total cost in the active currency unit
      const totalCost = isDemoSats
        ? price * quantity * DEMO_SATS_PRICE_MULTIPLIER
        : price * quantity;

      // Check affordability and pay
      if (isDemoSats) {
        if (currentProfile.sats < totalCost) {
          throw new Error(
            `Insufficient demo sats. You need ${totalCost} demo sats but only have ${currentProfile.sats}.`
          );
        }
      } else if (isBtcSats) {
        // Pay with real BTC sats before updating storage
        await paySats(totalCost, `Pets shop: ${item.name}`);
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
      if (isDemoSats) {
        updates.sats = (currentProfile.sats - totalCost).toString();
      }

      const updatedTags = updateBlobbonautTags(prev.tags, updates);

      // Publish updated profile event
      const event = await publishEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content: prev.content,
        tags: updatedTags,
        prev,
      });

      return { event, item, quantity, totalCost, currency: isDemoSats ? 'demo sats' : 'sats' as const };
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
