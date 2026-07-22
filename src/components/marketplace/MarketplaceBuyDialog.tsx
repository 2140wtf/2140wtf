import { useMemo } from 'react';

import { ZapDialog } from '@/components/ZapDialog';
import { useBtcPrice } from '@/hooks/useBtcPrice';
import { getListingPriceState } from '@/lib/marketplace';
import { type Nip99Listing } from '@/lib/nip99';

interface MarketplaceBuyDialogProps {
  listing: Nip99Listing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Buy dialog for a NIP-99 listing.
 *
 * Reuses the existing ZapDialog payment rails (Lightning, on-chain, NWC, WebLN)
 * prefilled with the listing price. Unsupported fiat currencies fall back to the
 * standard ZapDialog so the buyer can still send a manual amount, while the
 * listing card disables the one-tap checkout button for those currencies.
 */
export function MarketplaceBuyDialog({ listing, open, onOpenChange }: MarketplaceBuyDialogProps) {
  const { btcPrice } = useBtcPrice(open && !!listing.price);

  const priceState = useMemo(
    () => getListingPriceState(listing, btcPrice),
    [listing, btcPrice],
  );

  return (
    <ZapDialog
      target={listing.event as import('nostr-tools').Event}
      open={open}
      onOpenChange={onOpenChange}
      initialAmountSats={priceState.kind === 'ready' ? priceState.initialAmountSats : undefined}
      allowedPaymentMethods={listing.paymentMethods.length > 0 ? listing.paymentMethods : undefined}
    />
  );
}
