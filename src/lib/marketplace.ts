import { formatSats } from '@/lib/bitcoin';
import { formatNip99Price, isValidListingPrice, type Nip99Listing } from '@/lib/nip99';

/** Hard ceiling on any computed checkout total in sats (round 30).
 *
 * The Bitcoin supply bound: a listing whose price converts above this is not
 * a real product, it is a malformed or hostile tag (e.g. `price: 1e12 sats`,
 * or a 0.01-BTC listing after a corrupted exchange rate). Every computed
 * sats amount is capped so a hostile listing can neither inflate the buyer's
 * order total nor produce an amount downstream payment executors reject. */
export const MAX_ORDER_SATS = 2_100_000_000_000_000;

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
  if (!isValidListingPrice(price.value) || price.value <= 0) return { kind: 'unsupported' };

  const currency = price.currency.trim().toLowerCase();

  // Round 30: sats/sat/btc prices are intrinsically denominated — they never
  // depended on the BTC rate, so requiring one made every sats-denominated
  // listing unorderable whenever the rate API was down (the dialog showed
  // "Loading price…" forever). Only fiat→sats conversion needs the rate.
  if (currency === 'sats' || currency === 'sat') {
    const sats = Math.round(price.value);
    if (sats <= 0 || sats > MAX_ORDER_SATS) return { kind: 'unsupported' };
    return { kind: 'ready', amountSats: sats, initialAmountSats: sats };
  }

  if (currency === 'btc') {
    const sats = Math.round(price.value * 100_000_000);
    if (sats <= 0 || sats > MAX_ORDER_SATS) return { kind: 'unsupported' };
    return { kind: 'ready', amountSats: sats, initialAmountSats: sats };
  }

  if (['usd', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'ars', 'brl', 'mxn'].includes(currency)) {
    if (!btcPrice || !Number.isFinite(btcPrice) || btcPrice <= 0) return { kind: 'loading' };
    const sats = Math.round((price.value / btcPrice) * 100_000_000);
    if (sats <= 0 || sats > MAX_ORDER_SATS) return { kind: 'unsupported' };
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
