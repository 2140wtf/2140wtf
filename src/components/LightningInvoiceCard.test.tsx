import { describe, expect, it } from 'vitest';
import { parseBolt11Amount } from '@/lib/bolt11';

describe('parseBolt11Amount', () => {
  it('returns null for non-invoice strings', () => {
    expect(parseBolt11Amount('')).toBeNull();
    expect(parseBolt11Amount('not an invoice')).toBeNull();
    expect(parseBolt11Amount('lnbc')).toBeNull();
  });

  it('parses amountless invoices as null', () => {
    expect(parseBolt11Amount('lnbc1example')).toBeNull();
    expect(parseBolt11Amount('lnbc1pwjekax')).toBeNull();
  });

  it('parses BTC-denominated invoices', () => {
    expect(parseBolt11Amount('lnbc10n1example')).toBe(1);
    expect(parseBolt11Amount('lnbc1u1example')).toBe(100);
    expect(parseBolt11Amount('lnbc1m1example')).toBe(100_000);
  });

  it('parses satoshi-denominated invoices (no multiplier)', () => {
    // Invoices encoded as whole bitcoin default to BTC; real BOLT11 amounts
    // without multiplier are interpreted as BTC in the regex. This test
    // documents the existing behavior.
    expect(parseBolt11Amount('lnbc1p1example')).toBe(0.0001);
  });

  it('is case-insensitive for prefix', () => {
    expect(parseBolt11Amount('LNBC10n1example')).toBe(1);
  });
});
