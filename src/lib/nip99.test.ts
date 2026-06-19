import { describe, expect, it } from 'vitest';
import { parseNip99Listing } from '@/lib/nip99';

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
});
