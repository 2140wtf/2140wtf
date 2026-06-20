import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { useBaoPayment } from '@/pets/core/hooks/useBaoPayment';
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
 * - Coin deduction
 * - Storage updates (stacking or adding new items)
 * - Atomic profile update (coins + storage in single event)
 * - Optimistic updates and error handling
 */
export function usePetsPurchaseItem(
  currentProfile: BlobbonautProfile | null,
  baoWallet?: (CashuWalletState & CashuWalletActions) | null,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const { payBaoSats } = useBaoPayment(baoWallet);
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

      // Calculate total cost
      const totalCost = price * quantity;

      const isBaoMode = currentProfile.walletMode === 'bao';

      // Check affordability
      if (!isBaoMode && currentProfile.coins < totalCost) {
        throw new Error(`Insufficient coins. You need ${totalCost} coins but only have ${currentProfile.coins}.`);
      }

      if (isBaoMode) {
        // Pay with BAO signet sats before updating storage
        await payBaoSats(totalCost, `Pets shop: ${item.name}`);
      }

      // Calculate new coins (only used in demo mode)
      const newCoins = currentProfile.coins - totalCost;

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
      if (!isBaoMode) {
        updates.coins = newCoins.toString();
      }

      const updatedTags = updateBlobbonautTags(prev.tags, updates);

      // Publish updated profile event
      const event = await publishEvent({
        kind: KIND_BLOBBONAUT_PROFILE,
        content: prev.content,
        tags: updatedTags,
        prev,
      });

      return { event, item, quantity, totalCost };
    },
    onSuccess: ({ item, quantity, totalCost }) => {
      // Invalidate profile query to refetch fresh data
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['blobbonaut-profile', user.pubkey] });
      }

      // Show success toast
      toast({
        title: 'Purchase Successful!',
        description: `You bought ${item.name} (×${quantity}) for ${totalCost} coins.`,
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
