import { describe, expect, it } from 'vitest';
import { getListingPriceState, formatBuyAmount } from '@/lib/marketplace';
import type { Nip99Listing } from '@/lib/nip99';

function makeListing(price: { value: number; currency: string } | undefined | null): Nip99Listing {
  return {
    id: 'test',
    eventId: '1',
    pubkey: '00',
    dTag: 'test',
    title: 'Test',
    summary: '',
    content: '',
    price,
    images: [],
    categories: [],
    status: 'active',
    shippingOptionRefs: [],
    createdAt: 0,
    publishedAt: 0,
    event: { id: '1', pubkey: '00', kind: 30402, tags: [], content: '', created_at: 0, sig: '' },
  } as Nip99Listing;
}

describe('getListingPriceState', () => {
  it('returns no-price when price is missing', () => {
    expect(getListingPriceState(makeListing(undefined), 100_000)).toEqual({ kind: 'no-price' });
    expect(getListingPriceState(makeListing(null), 100_000)).toEqual({ kind: 'no-price' });
  });

  it('rejects non-positive and non-finite prices', () => {
    expect(getListingPriceState(makeListing({ value: 0, currency: 'USD' }), 100_000).kind).toBe('unsupported');
    expect(getListingPriceState(makeListing({ value: -5, currency: 'USD' }), 100_000).kind).toBe('unsupported');
    expect(getListingPriceState(makeListing({ value: NaN, currency: 'USD' }), 100_000).kind).toBe('unsupported');
  });

  it('returns loading when BTC price is needed but unavailable', () => {
    expect(getListingPriceState(makeListing({ value: 1000, currency: 'sats' }), undefined).kind).toBe('loading');
  });

  it('converts sats to USD amount', () => {
    const state = getListingPriceState(makeListing({ value: 100_000, currency: 'sats' }), 100_000);
    expect(state).toEqual({ kind: 'ready', amountSats: 100_000, initialUsdAmount: 100 });
  });

  it('converts BTC to sats and USD', () => {
    const state = getListingPriceState(makeListing({ value: 0.001, currency: 'btc' }), 100_000);
    expect(state).toEqual({ kind: 'ready', amountSats: 100_000, initialUsdAmount: 100 });
  });

  it('converts USD to sats', () => {
    const state = getListingPriceState(makeListing({ value: 50, currency: 'usd' }), 100_000);
    expect(state).toEqual({ kind: 'ready', amountSats: 50_000, initialUsdAmount: 50 });
  });

  it('rejects unsupported currencies', () => {
    expect(getListingPriceState(makeListing({ value: 10, currency: 'eur' }), 100_000).kind).toBe('unsupported');
  });

  it('rejects BTC amounts that round to zero sats', () => {
    expect(getListingPriceState(makeListing({ value: 1e-12, currency: 'btc' }), 100_000).kind).toBe('unsupported');
  });

  it('is case-insensitive for currency', () => {
    const state = getListingPriceState(makeListing({ value: 100_000, currency: 'SATS' }), 100_000);
    expect(state).toEqual({ kind: 'ready', amountSats: 100_000, initialUsdAmount: 100 });
  });
});

describe('formatBuyAmount', () => {
  it('formats ready sats amount', () => {
    const listing = makeListing({ value: 100_000, currency: 'sats' });
    expect(formatBuyAmount(listing, 100_000)).toContain('100,000');
  });

  it('falls back to formatted price for unsupported currency', () => {
    const listing = makeListing({ value: 10, currency: 'eur' });
    expect(formatBuyAmount(listing, 100_000)).toBe('10 eur');
  });

  it('falls back to price on request when price is null', () => {
    const listing = makeListing(null);
    expect(formatBuyAmount(listing, 100_000)).toBe('Price on request');
  });
});
