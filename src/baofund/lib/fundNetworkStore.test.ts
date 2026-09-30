/**
 * Runtime universe selection: env sets the default, an explicit choice wins
 * and persists, subscribers fire on change, reset restores the default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getFundNetwork,
  resetFundNetwork,
  setFundNetwork,
  subscribeFundNetwork,
} from './fundNetworkStore';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

describe('fundNetworkStore', () => {
  it('defaults to testnet without env or a stored choice', () => {
    expect(getFundNetwork()).toBe('testnet');
  });

  it('uses the build-time env as the default', () => {
    vi.stubEnv('VITE_BAO_FUND_NETWORK', 'demo');
    expect(getFundNetwork()).toBe('demo');
  });

  it('a runtime choice wins over the env and persists', () => {
    setFundNetwork('demo');
    vi.stubEnv('VITE_BAO_FUND_NETWORK', 'testnet');
    expect(getFundNetwork()).toBe('demo');
    expect(localStorage.getItem('bao.fund.network')).toBe('demo');
  });

  it('notifies subscribers and reset restores the deployment default', () => {
    const listener = vi.fn();
    const off = subscribeFundNetwork(listener);
    setFundNetwork('demo');
    expect(listener).toHaveBeenCalledTimes(1);
    resetFundNetwork();
    expect(getFundNetwork()).toBe('testnet');
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    setFundNetwork('demo');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores a corrupted stored value', () => {
    localStorage.setItem('bao.fund.network', 'mainnet');
    expect(getFundNetwork()).toBe('testnet');
  });
});
