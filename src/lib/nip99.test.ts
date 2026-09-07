import { describe, expect, it } from 'vitest';
import { formatNip99Price, parseNip99Listing } from '@/lib/nip99';

function makeEvent(tags: string[][] = [], content = ''): Parameters<typeof parseNip99Listing>[0] {
  return {
    id: 'event-id',
    pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
    kind: 30402,
    tags: [['d', 'test'], ...tags],
    content,
    created_at: 1234567890,
    sig: 'sig',
  };
}

describe('parseNip99Listing', () => {
  it('parses a basic listing', () => {
    const event = makeEvent([
      ['title', 'Test Product'],
      ['summary', 'A great product'],
      ['price', '5000', 'SATS'],
      ['image', 'https://example.com/img.jpg'],
      ['t', 'product'],
    ]);
    const listing = parseNip99Listing(event);
    expect(listing).not.toBeNull();
    expect(listing?.title).toBe('Test Product');
    expect(listing?.price).toEqual({ value: 5000, currency: 'SATS' });
    expect(listing?.images).toEqual(['https://example.com/img.jpg']);
    expect(listing?.categories).toContain('product');
    expect(listing?.shippingOptionRefs).toEqual([]);
  });

  it('parses stock, format, and delivery tags', () => {
    const event = makeEvent([
      ['title', 'Limited Item'],
      ['price', '1000', 'sats'],
      ['stock', '5'],
      ['type', 'simple'],
      ['format', 'physical'],
      ['delivery', 'post'],
    ]);
    const listing = parseNip99Listing(event)!;
    expect(listing.stock).toBe(5);
    expect(listing.type).toBe('simple');
    expect(listing.format).toBe('physical');
    expect(listing.delivery).toBe('post');
  });

  it('parses shipping_option references', () => {
    const event = makeEvent([
      ['title', 'Shipped Item'],
      ['shipping_option', '30406:pubkey:d1'],
      ['shipping_option', '30406:pubkey:d2', '500'],
    ]);
    const listing = parseNip99Listing(event)!;
    expect(listing.shippingOptionRefs).toEqual([
      { address: '30406:pubkey:d1' },
      { address: '30406:pubkey:d2', extraCost: 500 },
    ]);
  });

  it('recognises delivery aliases', () => {
    const pickup = parseNip99Listing(makeEvent([['delivery', 'pickup']]));
    expect(pickup?.delivery).toBe('collect-in-person');

    const digital = parseNip99Listing(makeEvent([['delivery', 'download']]));
    expect(digital?.delivery).toBe('digital');
  });

  it('filters invalid image urls', () => {
    const event = makeEvent([
      ['image', 'not-a-url'],
      ['image', 'https://example.com/ok.png'],
      ['image', 'ftp://example.com/file.png'],
    ]);
    const listing = parseNip99Listing(event)!;
    expect(listing.images).toEqual(['https://example.com/ok.png']);
  });

  // ── Round 30: adversarial ingestion (relay-supplied attacker fields) ──

  it('rejects an Infinity price tag (Number("1e999") === Infinity)', () => {
    const listing = parseNip99Listing(makeEvent([['price', '1e999', 'sats']]));
    expect(listing?.price).toBeNull();
  });

  it('rejects prices above the Bitcoin supply bound', () => {
    const listing = parseNip99Listing(makeEvent([['price', '9e16', 'sats']]));
    expect(listing?.price).toBeNull();
  });

  it('accepts a price at the exact supply bound', () => {
    const listing = parseNip99Listing(makeEvent([['price', '21000000000000000', 'sats']]));
    expect(listing?.price?.value).toBe(21_000_000_000_000_000);
  });

  it('caps image count and length', () => {
    const images = Array.from({ length: 50 }, (_, i) => [`image`, `https://example.com/${i}.png`] as string[]);
    const long = 'https://example.com/' + 'a'.repeat(5000) + '.png';
    const listing = parseNip99Listing(makeEvent([...images, ['image', long]]));
    expect(listing!.images.length).toBeLessThanOrEqual(20);
    expect(listing!.images.every((u) => u.length <= 2_000)).toBe(true);
  });

  it('caps category count and length', () => {
    const cats = Array.from({ length: 60 }, (_, i) => ['t', `cat${i}`.padEnd(100, 'x')] as string[]);
    const listing = parseNip99Listing(makeEvent(cats));
    expect(listing!.categories.length).toBeLessThanOrEqual(30);
    expect(listing!.categories.every((c) => c.length <= 64)).toBe(true);
  });

  it('caps title, summary, content, and location lengths', () => {
    const blob = 'x'.repeat(10_000);
    const listing = parseNip99Listing(
      makeEvent([['title', blob], ['summary', blob], ['location', blob]], blob),
    );
    expect(listing!.title.length).toBeLessThanOrEqual(2_000);
    expect(listing!.summary.length).toBeLessThanOrEqual(2_000);
    expect(listing!.content.length).toBeLessThanOrEqual(2_000);
    expect(listing!.location!.length).toBeLessThanOrEqual(200);
  });

  it('caps shipping_option refs and rejects non-finite extraCost', () => {
    const refs = Array.from({ length: 40 }, (_, i) => ['shipping_option', `30406:pk:d${i}`, '500'] as string[]);
    const listing = parseNip99Listing(
      makeEvent([...refs, ['shipping_option', '30406:pk:extra', '1e999']]),
    );
    expect(listing!.shippingOptionRefs.length).toBeLessThanOrEqual(20);
    expect(listing!.shippingOptionRefs.every((r) => r.extraCost === undefined || Number.isFinite(r.extraCost))).toBe(true);
  });

  it('rejects absurd published_at timestamps', () => {
    const listing = parseNip99Listing(makeEvent([['published_at', '99999999999999']]));
    expect(listing?.publishedAt).toBeUndefined();
  });

  it('caps currency and frequency tag lengths', () => {
    const blob = 'c'.repeat(5_000);
    const listing = parseNip99Listing(makeEvent([['price', '100', blob, blob]]));
    expect(listing!.price!.currency.length).toBeLessThanOrEqual(16);
    expect(listing!.price!.frequency!.length).toBeLessThanOrEqual(64);
  });
});

describe('formatNip99Price', () => {
  it('returns price on request when price is missing', () => {
    expect(formatNip99Price(null)).toBe('Price on request');
  });

  it('formats USD without floating-point noise', () => {
    expect(formatNip99Price({ value: 1.8808200000000002, currency: 'USD' })).toBe('$1.88');
    expect(formatNip99Price({ value: 1234.5, currency: 'usd' })).toBe('$1,234.50');
  });

  it('formats sats with thousand separators', () => {
    expect(formatNip99Price({ value: 1000, currency: 'sats' })).toBe('1,000 sats');
    expect(formatNip99Price({ value: 1, currency: 'sat' })).toBe('1 sat');
  });

  it('formats BTC without trailing zeros', () => {
    expect(formatNip99Price({ value: 1, currency: 'BTC' })).toBe('1 BTC');
    expect(formatNip99Price({ value: 0.001, currency: 'btc' })).toBe('0.001 BTC');
    expect(formatNip99Price({ value: 0.12345678, currency: 'btc' })).toBe('0.12345678 BTC');
  });

  it('appends frequency when present', () => {
    expect(formatNip99Price({ value: 50, currency: 'USD', frequency: 'month' })).toBe('$50.00 / month');
  });

  it('falls back to raw value for unknown currencies', () => {
    expect(formatNip99Price({ value: 10, currency: 'eur' })).toBe('10 eur');
  });
});
