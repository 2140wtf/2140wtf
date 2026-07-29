import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { toast } from '@/hooks/useToast';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';
import { updateNostrPetProfile } from '@/pets/core/lib/profile-sats';
import type { NostrEvent } from '@nostrify/nostrify';

import type { CashuWallet, MintKeyset } from '@cashu/cashu-ts';

import type { PurchaseRequest } from '../types/shop.types';
import type { PetsWalletMode } from '@/pets/core/hooks/usePetsWallet';
import type { NostrPetProfile, PetsCompanion, StorageItem } from '@/pets/core/lib/pets';
import {
  KIND_PETS_STATE,
  updateNostrPetProfileTags,
  createStorageTags,
  updatePetsTags,
} from '@/pets/core/lib/pets';
import { getShopItemById } from '../lib/pets-shop-items';

function getSelectedMintBalance(wallet?: (CashuWalletState & CashuWalletActions) | null): number {
  if (!wallet?.mintUrl) return 0;
  return wallet.balances?.[wallet.mintUrl] ?? 0;
}

/**
 * Paid-but-incomplete purchase journal (localStorage).
 *
 * The shop pays the treasury by nutzap BEFORE the profile update that grants
 * the item. If the profile update fails, the payment is already gone and the
 * error tells the user to contact support — but the Buy button re-arms, and
 * without a journal a retry would send a SECOND nutzap for the same item.
 * Journaling the payment lets a retry complete the delivery without paying
 * again. Entries are per (pubkey, itemId): at most one uncompleted paid
 * purchase per item can exist, and it is cleared as soon as the item lands.
 */
const PAID_PENDING_PREFIX = 'pets-shop-paid-pending';

interface PaidPendingPurchase {
  quantity: number;
  amountSats: number;
  mintUrl: string | null;
  paidAt: number;
}

function paidPendingKey(pubkey: string, itemId: string): string {
  return `${PAID_PENDING_PREFIX}:${pubkey}:${itemId}`;
}

function readPaidPending(pubkey: string, itemId: string): PaidPendingPurchase | null {
  try {
    const raw = localStorage.getItem(paidPendingKey(pubkey, itemId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PaidPendingPurchase>;
    if (typeof parsed.quantity !== 'number' || typeof parsed.amountSats !== 'number') return null;
    return {
      quantity: parsed.quantity,
      amountSats: parsed.amountSats,
      mintUrl: typeof parsed.mintUrl === 'string' ? parsed.mintUrl : null,
      paidAt: typeof parsed.paidAt === 'number' ? parsed.paidAt : 0,
    };
  } catch {
    return null;
  }
}

function writePaidPending(pubkey: string, itemId: string, entry: PaidPendingPurchase): void {
  try {
    localStorage.setItem(paidPendingKey(pubkey, itemId), JSON.stringify(entry));
  } catch {
    // Journal is best-effort; a full localStorage must not block the purchase.
  }
}

function clearPaidPending(pubkey: string, itemId: string): void {
  try {
    localStorage.removeItem(paidPendingKey(pubkey, itemId));
  } catch {
    // Ignore — a stale entry only makes the next retry skip a re-payment.
  }
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
export const PET_FIAT_RESERVE_SATS = 100;

/**
 * Compute how much of a sats-priced purchase is covered by starter currency
 * vs the wallet. Starter currency is ONE logical fiat rail with two storage
 * pots: the pet-bound balance spends first (down to a small reserve so the
 * pet is not emptied to zero), then the account coins pot; only the remainder
 * hits the wallet.
 */
export function splitSatsPayment(
  totalSatsCost: number,
  petFiatBalance: number,
  coinsBalance = 0,
): { petFiatSpend: number; coinsSpend: number; walletSatsCost: number } {
  if (totalSatsCost <= 0) return { petFiatSpend: 0, coinsSpend: 0, walletSatsCost: 0 };

  // Pet-bound fiat first, always leaving the reserve untouched.
  const petFiatSpend = petFiatBalance >= PET_FIAT_RESERVE_SATS
    ? Math.min(totalSatsCost, petFiatBalance - PET_FIAT_RESERVE_SATS)
    : 0;
  const afterPet = totalSatsCost - petFiatSpend;

  // Then account coins, then the wallet.
  const coinsSpend = Math.min(Math.max(0, coinsBalance), afterPet);
  return { petFiatSpend, coinsSpend, walletSatsCost: afterPet - coinsSpend };
}

/**
 * Split a fiat-priced purchase across the starter-currency pots: pet-bound
 * fiat first (down to the reserve), then account coins. Returns null when the
 * combined starter currency cannot cover the cost.
 */
export function splitFiatPayment(
  totalFiatCost: number,
  petFiatBalance: number,
  coinsBalance: number,
): { petFiatSpend: number; coinsSpend: number } | null {
  if (totalFiatCost <= 0) return { petFiatSpend: 0, coinsSpend: 0 };
  const petFiatSpend = petFiatBalance >= PET_FIAT_RESERVE_SATS
    ? Math.min(totalFiatCost, petFiatBalance - PET_FIAT_RESERVE_SATS)
    : 0;
  const coinsSpend = totalFiatCost - petFiatSpend;
  if (coinsSpend > Math.max(0, coinsBalance)) return null;
  return { petFiatSpend, coinsSpend };
}

/**
 * Hook to purchase items from the Pets Shop.
 *
 * Handles:
 * - Starter currency — ONE fiat rail stored in two pots: the pet-bound fiat
 *   balance spends first (down to a reserve), then the account coins pot.
 *   Fiat-priced items are covered by starter currency alone; sats-priced
 *   items use it first and the wallet covers the rest (demo mode only — see
 *   the note at the split below).
 * - Sats payment via a nutzap to the 2140 treasury from the active wallet:
 *   the real Cashu wallet in mainnet mode, the BAO signet Cashu wallet in
 *   demo mode. Same rail, separated by mint — demo sats are valueless.
 * - Storage updates (stacking or adding new items)
 * - Atomic profile update
 *
 * `walletMode` MUST be the mode that selected `externalWallet` (from
 * `usePetsWallet`). The rail is never derived from the relay-published
 * profile `wallet_mode` tag: that tag can desync across devices or when its
 * publish fails, and getting the rail wrong either spends real sats while
 * calling them "demo" or sends valueless signet tokens to the treasury as
 * if they were real payment.
 */
export function usePetsPurchaseItem(
  currentProfile: NostrPetProfile | null,
  companion?: PetsCompanion | null,
  externalWallet?: (CashuWalletState & CashuWalletActions) | null,
  onCompanionUpdated?: (event: NostrEvent) => void,
  walletMode?: PetsWalletMode,
) {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { mutateAsync: publishEvent, petsEnabled } = usePetsNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, price, quantity, currency: requestedCurrency }: PurchaseRequest) => {
      if (!user?.pubkey) {
        throw new Error('You must be logged in to purchase items');
      }

      if (!currentProfile) {
        throw new Error('Profile not found');
      }

      // Check the publish preference BEFORE any payment: every successful
      // purchase ends with a profile/companion publish, which is guarded by
      // this preference and throws deterministically when it is off. Paying
      // the treasury first and only then hitting the guard strands the sats
      // (hunt finding: nutzap sent before a 100%-deterministic failure).
      if (!petsEnabled) {
        throw new Error(
          'Pets publishing is disabled. Turn on “Publish pet events” in Settings → Privacy & Publishing to buy items.',
        );
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

      // The rail comes from the wallet actually being charged (passed in by
      // the caller), not from the profile `wallet_mode` tag — the tag is only
      // a cross-device hint and may be stale. Fallback to the tag only when
      // the caller did not say which wallet it handed us.
      const isCashuMode = walletMode !== undefined
        ? walletMode === 'cashu'
        : currentProfile.walletMode === 'cashu';

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
        if (isCashuMode) {
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
      let treasuryPaid = false;
      let petFiatSpend = 0;
      let coinsSpend = 0;
      let walletSatsCost = 0;

      if (resolvedCurrency === 'sats') {
        currency = isCashuMode ? 'sats' : 'demo sats';
        totalCost = totalSatsCost;

        // Split the cost between starter currency (pet fiat, then account
        // coins) and the wallet — DEMO MODE ONLY. Both starter pots are
        // self-declared tags on the user's own events (every egg starts with
        // 2140 and anyone can republish them at any value), so letting them
        // offset REAL sats would let anyone mint themselves free items paid
        // for by the 2140 treasury. In mainnet mode the wallet always pays
        // the full cost.
        const split = isCashuMode
          ? { petFiatSpend: 0, coinsSpend: 0, walletSatsCost: totalSatsCost }
          : splitSatsPayment(totalSatsCost, companion?.fiatBalance ?? 0, currentProfile.coins);
        petFiatSpend = split.petFiatSpend;
        coinsSpend = split.coinsSpend;
        walletSatsCost = split.walletSatsCost;

        if (walletSatsCost > 0) {
          // Both modes pay the 2140 treasury by nutzap. In mainnet mode the
          // active wallet is the user's real Cashu wallet; in demo mode it is
          // the BAO signet Cashu wallet (valueless sats on the BAO mint).
          if (!externalWallet) {
            throw new Error('External wallet is not available.');
          }
          const treasuryNpub = config.petsTreasuryNpub;
          if (!treasuryNpub) {
            throw new Error('Pets treasury is not configured.');
          }

          // Idempotency: if a previous attempt already paid for this item but
          // never delivered it (profile/companion update failed), complete the
          // delivery WITHOUT paying again. Without this journal the Buy button
          // re-arms and a retry sends a second nutzap for the same item.
          const pendingPurchase = readPaidPending(user.pubkey, itemId);
          if (pendingPurchase) {
            if (pendingPurchase.quantity !== quantity) {
              throw new Error(
                'A previous payment for this item did not complete. Please contact 2140 support before buying it again.',
              );
            }
            console.warn(
              `[usePetsPurchaseItem] Completing delivery of a previously paid purchase (${pendingPurchase.amountSats} sats, paid ${new Date(pendingPurchase.paidAt).toISOString()}) — skipping the treasury payment.`,
            );
            treasuryPaid = true;
          } else {
            if (!externalWallet.mintUrl) {
              throw new Error('Select a mint in your Cashu wallet before buying with sats.');
            }
            const selectedMintBalance = getSelectedMintBalance(externalWallet);
            const feeReserve = estimateCashuSendFee(walletSatsCost, externalWallet.wallet ?? null);
            const totalNeeded = walletSatsCost + feeReserve;
            if (selectedMintBalance < totalNeeded) {
              throw new Error(
                `Insufficient balance on the selected mint. You need ${walletSatsCost.toLocaleString()} sats + ~${feeReserve.toLocaleString()} sats fee (${totalNeeded.toLocaleString()} total) but only have ${selectedMintBalance.toLocaleString()} sats on ${externalWallet.mintUrl ?? 'the selected mint'}.`
              );
            }
            // Pay the 2140 treasury BEFORE updating the profile so a payment failure
            // cannot grant a free item. Nutzaps cannot be clawed back automatically;
            // if the profile update fails after this point we surface a clear error
            // so support can refund from the treasury side.
            const sendResult = await externalWallet.sendNutzap(walletSatsCost, treasuryNpub, externalWallet.mintUrl, {
              memo: `Pets shop: ${item.name}`,
            });
            if (sendResult.status === 'failed') {
              throw new Error(externalWallet.error ?? 'Payment to the Pets treasury failed.');
            }
            // 'sent' or 'pending': the sats are gone either way — a pending
            // nutzap is saved and auto-retried until it lands, so the purchase
            // MUST proceed. Telling the user it failed would invite a retry and
            // a second payment for the same item. Journal the payment FIRST so
            // any later failure lets a retry complete delivery without paying again.
            writePaidPending(user.pubkey, itemId, {
              quantity,
              amountSats: walletSatsCost,
              mintUrl: externalWallet.mintUrl,
              paidAt: Date.now(),
            });
            treasuryPaid = true;
          }
        }
      } else {
        currency = 'fiat coins';
        totalCost = totalFiatCost;

        // Fiat purchases are paid from starter currency only — pet-bound fiat
        // first (down to the reserve), then account coins. Both pots are
        // self-declared game currency, so this is safe in either wallet mode.
        const fiatSplit = splitFiatPayment(totalFiatCost, companion?.fiatBalance ?? 0, currentProfile.coins);
        if (!fiatSplit) {
          const combined = (companion?.fiatBalance ?? 0) + currentProfile.coins;
          throw new Error(
            `Insufficient starter currency. You need ${totalFiatCost.toLocaleString()} but have ${combined.toLocaleString()}.`
          );
        }
        petFiatSpend = fiatSplit.petFiatSpend;
        coinsSpend = fiatSplit.coinsSpend;
      }

      // If pet-bound fiat is being spent (demo mode only), publish the companion
      // update next. This happens outside the profile serialization because it
      // is a different kind (31124 vs 11125). Note the treasury nutzap above
      // has ALREADY been sent at this point, so a failure here must surface the
      // same paid-but-incomplete support path as a profile-update failure —
      // silently rethrowing would invite the user to retry and pay twice.
      let companionEvent: NostrEvent | undefined;
      if (petFiatSpend > 0 && companion) {
        try {
          const newFiatBalance = Math.max(0, companion.fiatBalance - petFiatSpend);
          const petTags = updatePetsTags(companion.event.tags, {
            fiat_balance: newFiatBalance.toString(),
          });
          companionEvent = await publishEvent({
            kind: KIND_PETS_STATE,
            content: companion.event.content,
            tags: petTags,
          });
        } catch (fiatPublishError) {
          if (treasuryPaid) {
            console.error('[usePetsPurchaseItem] Companion fiat update failed after treasury payment:', fiatPublishError);
            throw new Error(
              'Your payment was sent to the 2140 treasury, but the purchase could not be completed. ' +
                'Please contact 2140 support for a refund.',
            );
          }
          throw fiatPublishError;
        }
      }

      // Serialize the profile update so concurrent purchases/missions cannot
      // overwrite each other and double-spend in-game currency. The wallet mode
      // used for deductions is pinned to the mode at the time the user clicked
      // buy; if it changed between the UI render and the serialized update we
      // still honor the real-sats payment that was already made and do not
      // double-charge (or grant a free item) by re-deriving the currency.
      let result;
      try {
        result = await updateNostrPetProfile(nostr, publishEvent, user.pubkey, (freshProfile) => {
          if (!freshProfile) {
            throw new Error('Profile not found on relays');
          }

          if (coinsSpend > 0 && freshProfile.coins < coinsSpend) {
            throw new Error(
              `Insufficient starter currency. You need ${coinsSpend.toLocaleString()} coins but have ${freshProfile.coins.toLocaleString()}.`
            );
          }
          // Sats purchases were already paid by nutzap from the active wallet
          // before this serialized update — the profile `sats` tag is never
          // spent by the shop in either mode.

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
          if (coinsSpend > 0) {
            updates.coins = (freshProfile.coins - coinsSpend).toString();
          }

          const tags = updateNostrPetProfileTags(freshProfile.event.tags, updates);
          return { tags, content: freshProfile.event.content, meta: { currency, totalCost, petFiatSpend, coinsSpend } };
        });
      } catch (profileError) {
        // Roll back any companion fiat deduction before rethrowing.
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
            console.warn('[usePetsPurchaseItem] Restored pet fiat balance after profile update failure.');
          } catch (rollbackError) {
            console.error('[usePetsPurchaseItem] Failed to restore pet fiat balance after profile update failure:', rollbackError);
          }
        }
        if (treasuryPaid) {
          // The nutzap already reached the treasury relays and cannot be clawed
          // back automatically. Tell the user exactly what happened so support
          // can refund from the treasury side.
          console.error('[usePetsPurchaseItem] Profile update failed after treasury payment:', profileError);
          throw new Error(
            'Your payment was sent to the 2140 treasury, but the purchase could not be completed. ' +
              'Please contact 2140 support for a refund.',
          );
        }
        throw profileError;
      }

      if (!result) {
        throw new Error('Profile update returned no changes.');
      }

      // The item landed — any paid-pending journal entry has served its
      // purpose (no-op for fiat purchases that never wrote one).
      clearPaidPending(user.pubkey, itemId);

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
        petFiatSpend: (result.meta?.petFiatSpend as number | undefined) ?? 0,
        coinsSpend: (result.meta?.coinsSpend as number | undefined) ?? 0,
      };
    },
    onSuccess: ({ item, quantity, totalCost, currency, petFiatSpend, coinsSpend }) => {
      // Invalidate profile query to refetch fresh data
      if (user?.pubkey) {
        queryClient.invalidateQueries({ queryKey: ['nostr-pet-profile', user.pubkey] });
      }

      // Show success toast
      const starterSpend = petFiatSpend + coinsSpend;
      const starterPart = starterSpend > 0 ? ` (${starterSpend.toLocaleString()} from starter currency)` : '';
      toast({
        title: 'Purchase Successful!',
        description: `You bought ${item.name} (×${quantity}) for ${totalCost.toLocaleString()} ${currency}.${starterPart}`,
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
