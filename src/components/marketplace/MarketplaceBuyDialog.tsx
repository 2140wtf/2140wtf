import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ZapDialog } from '@/components/ZapDialog';
import { useAppContext } from '@/hooks/useAppContext';
import { fetchBtcPrice } from '@/lib/bitcoin';
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
  const { config } = useAppContext();
  const { data: btcPrice } = useQuery({
    queryKey: ['btc-price', config.esploraApis],
    queryFn: ({ signal }) => fetchBtcPrice(config.esploraApis, signal),
    staleTime: 30_000,
    enabled: open && !!listing.price,
  });

  const priceState = useMemo(
    () => getListingPriceState(listing, btcPrice),
    [listing, btcPrice],
  );

  return (
    <ZapDialog
      target={listing.event as import('nostr-tools').Event}
      open={open}
      onOpenChange={onOpenChange}
      initialUsdAmount={priceState.kind === 'ready' ? priceState.initialUsdAmount : undefined}
    />
  );
}
