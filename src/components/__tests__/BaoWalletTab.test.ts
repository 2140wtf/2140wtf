import { describe, expect, it } from 'vitest';

import { getRailBalance } from '../BaoWalletTab';
import type { BaoWalletBalances } from '@/lib/baoWalletApi';

const api: BaoWalletBalances = {
  lightning: 1000,
  ecash: 2000,
  cashu: 40660,
  spark: 3000,
  l1: 4000,
  liquid: 5000,
  ark: 6000,
};

describe('getRailBalance', () => {
  it('maps every rail to its API balance', () => {
    expect(getRailBalance('lightning', api, 0)).toBe(1000);
    expect(getRailBalance('cashu', api, 0)).toBe(40660);
    expect(getRailBalance('liquid', api, 0)).toBe(5000);
    expect(getRailBalance('spark', api, 0)).toBe(3000);
    expect(getRailBalance('ark', api, 0)).toBe(6000);
    expect(getRailBalance('fedimint', api, 0)).toBe(2000);
    expect(getRailBalance('l1', api, 0)).toBe(4000);
  });

  it('shows 0 when API cashu balance is 0 (local balance is separate)', () => {
    expect(getRailBalance('cashu', { ...api, cashu: 0 }, 1234)).toBe(0);
  });

  it('falls back to local cashu balance only when API is missing entirely', () => {
    expect(getRailBalance('cashu', undefined, 1234)).toBe(1234);
  });

  it('falls back to 0 for other rails when API is missing', () => {
    expect(getRailBalance('lightning', undefined, 0)).toBe(0);
    expect(getRailBalance('liquid', undefined, 0)).toBe(0);
    expect(getRailBalance('spark', undefined, 0)).toBe(0);
    expect(getRailBalance('ark', undefined, 0)).toBe(0);
    expect(getRailBalance('fedimint', undefined, 0)).toBe(0);
    expect(getRailBalance('l1', undefined, 0)).toBe(0);
  });
});
