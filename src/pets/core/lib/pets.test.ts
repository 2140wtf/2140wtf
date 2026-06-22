import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { parseWalletModeTag, setPetsRealSatsEnabled } from './pets';

describe('parseWalletModeTag', () => {
  beforeEach(() => {
    // Default state for safe testing: real-sats mode is disabled.
    setPetsRealSatsEnabled(false);
  });

  afterEach(() => {
    setPetsRealSatsEnabled(false);
  });

  it('returns "demo-sats" by default', () => {
    expect(parseWalletModeTag([])).toBe('demo-sats');
    expect(parseWalletModeTag([['wallet_mode', '']])).toBe('demo-sats');
    expect(parseWalletModeTag([['wallet_mode', 'unknown']])).toBe('demo-sats');
  });

  it('treats legacy "real" as demo-sats while real-sats is disabled', () => {
    expect(parseWalletModeTag([['wallet_mode', 'real']])).toBe('demo-sats');
  });

  it('always maps BAO signet/demo and btc-sats to btc-sats', () => {
    expect(parseWalletModeTag([['wallet_mode', 'bao']])).toBe('btc-sats');
    expect(parseWalletModeTag([['wallet_mode', 'btc-sats']])).toBe('btc-sats');
  });

  it('maps legacy "real" to "btc-sats" only when real-sats is enabled', () => {
    setPetsRealSatsEnabled(true);
    expect(parseWalletModeTag([['wallet_mode', 'real']])).toBe('btc-sats');
    expect(parseWalletModeTag([['wallet_mode', 'bao']])).toBe('btc-sats');
    expect(parseWalletModeTag([['wallet_mode', 'btc-sats']])).toBe('btc-sats');
  });
});
