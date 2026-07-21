import { describe, expect, it } from 'vitest';

import { parseWalletModeTag } from './pets';

describe('parseWalletModeTag', () => {
  it('returns "bao" (demo) by default so missing/unknown tags never touch real money', () => {
    expect(parseWalletModeTag([])).toBe('bao');
    expect(parseWalletModeTag([['wallet_mode', '']])).toBe('bao');
    expect(parseWalletModeTag([['wallet_mode', 'unknown']])).toBe('bao');
  });

  it('maps "bao" and legacy "demo-sats" to the BAO signet/demo wallet', () => {
    expect(parseWalletModeTag([['wallet_mode', 'bao']])).toBe('bao');
    expect(parseWalletModeTag([['wallet_mode', 'demo-sats']])).toBe('bao');
  });

  it('maps "cashu" and legacy real-money tags to the real Cashu wallet', () => {
    expect(parseWalletModeTag([['wallet_mode', 'cashu']])).toBe('cashu');
    expect(parseWalletModeTag([['wallet_mode', 'btc-sats']])).toBe('cashu');
    expect(parseWalletModeTag([['wallet_mode', 'real']])).toBe('cashu');
  });
});
