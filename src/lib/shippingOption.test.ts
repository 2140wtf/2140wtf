import { describe, expect, it } from 'vitest';
import { parseShippingOption, shippingOptionAddress } from '@/lib/shippingOption';

function makeEvent(tags: string[][] = []): Parameters<typeof parseShippingOption>[0] {
  return {
    id: 'event-id',
    pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
    kind: 30406,
    tags: [['d', 'shipping-1'], ...tags],
    content: '',
    created_at: 1234567890,
    sig: 'sig',
  };
}

describe('parseShippingOption', () => {
  it('parses a basic shipping option', () => {
    const event = makeEvent([
      ['title', 'Standard UK Delivery'],
      ['service', 'standard'],
      ['price', '500', 'SATS'],
      ['duration', '3-5 days'],
    ]);
    const option = parseShippingOption(event);
    expect(option).not.toBeNull();
    expect(option?.title).toBe('Standard UK Delivery');
    expect(option?.service).toBe('standard');
    expect(option?.price).toEqual({ value: 500, currency: 'SATS' });
    expect(option?.duration).toBe('3-5 days');
  });

  it('requires a valid service type', () => {
    const event = makeEvent([
      ['title', 'Unknown'],
      ['service', 'pigeon'],
    ]);
    expect(parseShippingOption(event)).toBeNull();
  });

  it('builds a NIP-33 address', () => {
    expect(shippingOptionAddress('pubkey', 'd-tag')).toBe('30406:pubkey:d-tag');
  });
});
