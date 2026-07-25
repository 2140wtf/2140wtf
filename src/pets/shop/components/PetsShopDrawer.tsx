// src/pets/shop/components/PetsShopDrawer.tsx

import { useMemo } from 'react';
import { ShoppingBag, Plus, Wallet as WalletIcon, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { usePetsPurchaseItem, estimateCashuSendFee, splitSatsPayment } from '../hooks/usePetsPurchaseItem';
import { PETS_SHOP_ITEMS } from '../lib/pets-shop-items';
import { usePetsWallet } from '@/pets/core/hooks/usePetsWallet';
import type { NostrPetProfile, PetsCompanion } from '@/pets/core/lib/pets';
import type { NostrEvent } from '@nostrify/nostrify';
import type { CashuWalletState, CashuWalletActions } from '@/hooks/useCashuWallet';
import type { ShopItem, ShopItemCategory } from '../types/shop.types';

interface PetsShopDrawerProps {
  profile: NostrPetProfile | null;
  companion?: PetsCompanion | null;
  externalWallet?: (CashuWalletState & CashuWalletActions) | null;
  onCompanionUpdated?: (event: NostrEvent) => void;
}

const CATEGORY_ORDER: ShopItemCategory[] = ['food', 'toy', 'medicine', 'hygiene', 'energy'];
const CATEGORY_LABELS: Record<ShopItemCategory, string> = {
  food: 'Food',
  toy: 'Toys',
  medicine: 'Medicine',
  hygiene: 'Hygiene',
  energy: 'Energy',
};

function effectSummary(effect: ShopItem['effect']): string {
  if (!effect) return '';
  const parts: string[] = [];
  if (effect.hunger) parts.push(`hunger ${effect.hunger > 0 ? '+' : ''}${effect.hunger}`);
  if (effect.happiness) parts.push(`happy ${effect.happiness > 0 ? '+' : ''}${effect.happiness}`);
  if (effect.health) parts.push(`health ${effect.health > 0 ? '+' : ''}${effect.health}`);
  if (effect.hygiene) parts.push(`hygiene ${effect.hygiene > 0 ? '+' : ''}${effect.hygiene}`);
  if (effect.energy) parts.push(`energy ${effect.energy > 0 ? '+' : ''}${effect.energy}`);
  return parts.join(' · ');
}

export function PetsShopDrawer({ profile, companion, externalWallet, onCompanionUpdated }: PetsShopDrawerProps) {
  const { realWallet, baoWallet, mode } = usePetsWallet();
  const { mutate: purchase, isPending } = usePetsPurchaseItem(profile ?? null, companion, externalWallet, onCompanionUpdated, mode);

  // The rail label comes from the wallet mode that selected the active
  // wallet, not the profile tag — same source of truth as the purchase hook.
  const isCashuMode = mode === 'cashu';
  // Spendable sats always come from the active wallet's selected mint — the
  // real Cashu wallet in mainnet mode, the BAO signet Cashu wallet in demo
  // mode. The profile `sats` tag (in-game earnings) is not spendable here.
  const walletBalance = externalWallet?.balances?.[externalWallet?.mintUrl ?? ''] ?? 0;
  const walletLoading = externalWallet?.loading ?? false;
  const fiatCoins = profile?.coins ?? 0;
  const demoSats = walletBalance;

  // Independent balance tracking for the two rails shown in the shop header.
  // BAO demo sats are shown from the cashu rail only (the BAO wallet).
  const baoSignetBalance = baoWallet?.totalBalance ?? 0;
  const baoSignetLoading = baoWallet?.loading ?? false;
  const cashuSatsBalance = realWallet?.totalBalance ?? 0;
  const cashuSatsLoading = realWallet?.loading ?? false;

  const storageMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of profile?.storage ?? []) {
      map.set(item.itemId, item.quantity);
    }
    return map;
  }, [profile?.storage]);

  const grouped = useMemo(() => {
    const groups: Record<ShopItemCategory, ShopItem[]> = {
      food: [],
      toy: [],
      medicine: [],
      hygiene: [],
      energy: [],
    };
    for (const item of PETS_SHOP_ITEMS) {
      if (item.status === 'live') {
        groups[item.type].push(item);
      }
    }
    return groups;
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <ShoppingBag className="size-5 text-primary" />
          <h2 className="font-semibold">Pet Shop</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="flex items-center gap-1.5">
            <WalletIcon className="size-3" />
            {walletLoading && demoSats === 0 ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span>{fiatCoins.toLocaleString()} fiat</span>
            )}
          </Badge>
          <Badge variant="secondary" className="flex items-center gap-1.5">
            <WalletIcon className="size-3" />
            {baoSignetLoading && baoSignetBalance === 0 ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span>{baoSignetBalance.toLocaleString()} ₿AO signet</span>
            )}
          </Badge>
          <Badge variant="secondary" className="flex items-center gap-1.5">
            <WalletIcon className="size-3" />
            {cashuSatsLoading && cashuSatsBalance === 0 ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <span>{cashuSatsBalance.toLocaleString()} Cashu sats</span>
            )}
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {CATEGORY_ORDER.map((category) => {
            const items = grouped[category];
            if (items.length === 0) return null;
            return (
              <div key={category}>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{CATEGORY_LABELS[category]}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {items.map((item) => {
                    const owned = storageMap.get(item.id) ?? 0;
                    const fiatPrice = item.fiatPrice ?? item.price;
                    const satsPrice = item.satsPrice ?? item.price;
                    const feeReserve = isCashuMode
                      ? estimateCashuSendFee(satsPrice, externalWallet?.wallet ?? null)
                      : 0;
                    // Mirror the purchase hook's demo-mode split: the pet's
                    // bound fiat balance pays first (down to its reserve) and
                    // the wallet only covers the remainder. Affordability must
                    // account for the pet's share — otherwise the Buy button
                    // stays disabled even when the pet could pay the whole
                    // price, and the sats price shown would not match what the
                    // wallet is actually charged.
                    const satsSplit = isCashuMode
                      ? { walletSatsCost: satsPrice }
                      : splitSatsPayment(satsPrice, companion?.fiatBalance ?? 0);
                    const satsNeeded = satsSplit.walletSatsCost + (satsSplit.walletSatsCost > 0 ? feeReserve : 0);
                    const canAffordFiat = fiatCoins >= fiatPrice;
                    const canAffordSats = demoSats >= satsNeeded;
                    const canAfford = canAffordFiat || canAffordSats;
                    return (
                      <Card key={item.id} className={cn('overflow-hidden', !canAfford && 'opacity-70')}>
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            <div className="text-3xl shrink-0">{item.icon}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium text-sm truncate">{item.name}</p>
                                {owned > 0 && (
                                  <Badge variant="outline" className="shrink-0 text-xs">
                                    ×{owned}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{effectSummary(item.effect)}</p>
                              <div className="flex items-center justify-between mt-2 gap-2">
                                <div className="text-xs leading-tight">
                                  <span className={cn('font-semibold', !canAffordFiat && 'text-muted-foreground')}>
                                    {fiatPrice.toLocaleString()} fiat
                                  </span>
                                  <span className="text-muted-foreground mx-1">or</span>
                                  <span className={cn('font-semibold', !canAffordSats && 'text-muted-foreground')}>
                                    {satsPrice.toLocaleString()} sats
                                  </span>
                                </div>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={!canAfford || isPending}
                                  onClick={() => {
                                    // In cashu mode always charge real sats;
                                    // otherwise prefer fiat coins and fall back to
                                    // demo sats so the button price matches the
                                    // currency actually deducted.
                                    const useFiat = !isCashuMode && canAffordFiat;
                                    purchase({
                                      itemId: item.id,
                                      price: useFiat ? fiatPrice : satsPrice,
                                      quantity: 1,
                                      currency: useFiat ? 'fiat' : 'sats',
                                    });
                                  }}
                                  className="h-7 px-2 text-xs shrink-0"
                                >
                                  <Plus className="size-3 mr-1" />
                                  Buy
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
