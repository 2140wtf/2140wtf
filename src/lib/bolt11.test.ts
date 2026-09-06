import { describe, expect, it } from 'vitest';

import { parseBolt11Amount } from '@/lib/bolt11';

describe('parseBolt11Amount — adversarial hardening (round 23)', () => {
  it('parses legitimate invoice amounts exactly', () => {
    expect(parseBolt11Amount('lnbc10n1example')).toBe(1);
    expect(parseBolt11Amount('lnbc1u1example')).toBe(100);
    expect(parseBolt11Amount('lnbc1m1example')).toBe(100_000);
    // pico-BTC = 1e-12 BTC = 1e-4 sats: 210001 p = 21.0001 sats.
    expect(parseBolt11Amount('lnbc210001p1example')).toBe(21.0001);
  });

  it('returns null instead of a precision-corrupted value for crafted huge amounts', () => {
    // 17 digits: exact value 99999999999999999900 sats is NOT representable
    // in f64 — pre-fix this silently returned a rounded, wrong number.
    const crafted = 'lnbc999999999999999991p1x';
    const parsed = parseBolt11Amount(crafted);
    expect(parsed).toBeNull();
  });

  it('caps the digit run before parsing (regex-level rejection)', () => {
    // 16 digits exceeds the {1,15} cap — null without ever calling parseInt.
    expect(parseBolt11Amount('lnbc12345678901234561p1x')).toBeNull();
  });

  it('rejects overflow even when digits fit the cap (BTC multiplier x 1e8)', () => {
    // 15 digits x 1e8 exceeds Number.MAX_SAFE_INTEGER → guard returns null.
    expect(parseBolt11Amount('lnbc9999999999999991p1x')).toBeNull();
  });

  it('keeps nano/pico fractional sats (callers round for display/fees)', () => {
    expect(parseBolt11Amount('lnbc1p1example')).toBe(0.0001);
    expect(parseBolt11Amount('lnbc11p1example')).toBe(0.0011);
    // nano-BTC = 0.1 sats: 123 n = 12.3 sats — fractional but in-range.
    expect(parseBolt11Amount('lnbc123n1example')).toBe(12.3);
  });

  it('still treats amountless invoices as null', () => {
    expect(parseBolt11Amount('lnbc1pwjekax')).toBeNull();
    expect(parseBolt11Amount('')).toBeNull();
  });
});
