import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_FUND_API_BASE, TESTNET_MARKETS_API_BASE, marketsApiBase } from './fundNetwork';
import { resetFundNetwork, setFundNetwork } from './fundNetworkStore';

afterEach(() => resetFundNetwork());

describe('marketsApiBase', () => {
  it('uses the demo markets API for the demo universe', () => {
    setFundNetwork('demo');
    expect(marketsApiBase()).toBe(DEMO_FUND_API_BASE);
  });

  it('uses the public testnet markets API for the testnet universe', () => {
    setFundNetwork('testnet');
    expect(marketsApiBase()).toBe(TESTNET_MARKETS_API_BASE);
  });
});
