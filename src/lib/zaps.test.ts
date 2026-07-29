import { describe, expect, it } from 'vitest';

import { bolt11AmountSats, bolt11Info } from './zaps';

/** Real mainnet invoice for exactly 2,000 sats (light-bolt11-decoder README fixture). */
const REAL_INVOICE_2000_SATS =
  'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';

describe('bolt11Info', () => {
  it('decodes amount (msats) and payment hash from a real invoice', () => {
    const info = bolt11Info(REAL_INVOICE_2000_SATS);
    expect(info.amountMsats).toBe(2_000_000);
    expect(info.paymentHash).toBe('f5636521e98000697a6700b979c288ddad56cb3995a2eb07550872c466ccc3e5');
  });

  it('returns nulls instead of throwing for garbage input', () => {
    expect(bolt11Info('not an invoice')).toEqual({ amountMsats: null, paymentHash: null });
    expect(bolt11Info('')).toEqual({ amountMsats: null, paymentHash: null });
  });
});

describe('bolt11AmountSats', () => {
  it('returns whole sats', () => {
    expect(bolt11AmountSats(REAL_INVOICE_2000_SATS)).toBe(2000);
  });

  it('returns null for undecodable invoices', () => {
    expect(bolt11AmountSats('lnbc1garbage')).toBeNull();
  });
});
