import { describe, expect, it } from 'vitest';

import { parseWalletModeTag } from './pets';

describe('parseWalletModeTag', () => {
  it('returns "demo-sats" by default', () => {
    expect(parseWalletModeTag([])).toBe('demo-sats');
    expect(parseWalletModeTag([['wallet_mode', '']])).toBe('demo-sats');
    expect(parseWalletModeTag([['wallet_mode', 'unknown']])).toBe('demo-sats');
  });

  it('maps legacy "real" and "bao" modes to "btc-sats"', () => {
    expect(parseWalletModeTag([['wallet_mode', 'real']])).toBe('btc-sats');
    expect(parseWalletModeTag([['wallet_mode', 'bao']])).toBe('btc-sats');
  });

  it('returns "btc-sats" explicitly', () => {
    expect(parseWalletModeTag([['wallet_mode', 'btc-sats']])).toBe('btc-sats');
  });
});
