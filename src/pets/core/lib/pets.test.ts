import { describe, expect, it } from 'vitest';

import { parseWalletModeTag } from './pets';

describe('parseWalletModeTag', () => {
  it('returns "demo" by default', () => {
    expect(parseWalletModeTag([])).toBe('demo');
    expect(parseWalletModeTag([['wallet_mode', '']])).toBe('demo');
    expect(parseWalletModeTag([['wallet_mode', 'unknown']])).toBe('demo');
  });

  it('returns "real" for the legacy real Cashu mode', () => {
    expect(parseWalletModeTag([['wallet_mode', 'real']])).toBe('real');
  });

  it('returns "bao" for the BAO signet/demo mode', () => {
    expect(parseWalletModeTag([['wallet_mode', 'bao']])).toBe('bao');
  });
});
