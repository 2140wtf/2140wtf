import { formatSats } from '@/lib/bitcoin';
import { formatNip99Price, type Nip99Listing } from '@/lib/nip99';

export type BuyDialogPriceState =
  | { kind: 'ready'; amountSats: number; initialAmountSats: number | undefined }
  | { kind: 'unsupported' }
  | { kind: 'loading' }
  | { kind: 'no-price' };

export function getListingPriceState(
  listing: Nip99Listing,
  btcPrice: number | undefined,
): BuyDialogPriceState {
  const price = listing.price;
  if (!price) return { kind: 'no-price' };
  if (!Number.isFinite(price.value) || price.value <= 0) return { kind: 'unsupported' };

  const currency = price.currency.trim().toLowerCase();

  if (currency === 'sats' || currency === 'sat') {
    if (!btcPrice) return { kind: 'loading' };
    const sats = Math.round(price.value);
    if (sats <= 0) return { kind: 'unsupported' };
    return { kind: 'ready', amountSats: sats, initialAmountSats: sats };
  }

  if (currency === 'btc') {
    if (!btcPrice) return { kind: 'loading' };
    const sats = Math.round(price.value * 100_000_000);
    if (sats <= 0) return { kind: 'unsupported' };
    return { kind: 'ready', amountSats: sats, initialAmountSats: sats };
  }

  if (['usd', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'ars', 'brl', 'mxn'].includes(currency)) {
    if (!btcPrice) return { kind: 'loading' };
    const sats = Math.round((price.value / btcPrice) * 100_000_000);
    if (sats <= 0) return { kind: 'unsupported' };
    return { kind: 'ready', amountSats: sats, initialAmountSats: sats };
  }

  return { kind: 'unsupported' };
}

/** Human-readable summary of the computed checkout price for UI labels. */
export function formatBuyAmount(listing: Nip99Listing, btcPrice: number | undefined): string {
  const state = getListingPriceState(listing, btcPrice);
  if (state.kind === 'ready') {
    return `${formatSats(state.amountSats)} sats`;
  }
  if (state.kind === 'loading') {
    return 'Converting price…';
  }
  return formatNip99Price(listing.price) || 'Contact seller';
}
