import { describe, expect, it } from 'vitest';

import { getRailBalance, getRailTileBalance } from '../BaoWalletTab';
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
  it('maps custodial rails to their API balance', () => {
    expect(getRailBalance('lightning', api, 0)).toBe(1000);
    expect(getRailBalance('liquid', api, 0)).toBe(5000);
    expect(getRailBalance('spark', api, 0)).toBe(3000);
    expect(getRailBalance('ark', api, 0)).toBe(6000);
    expect(getRailBalance('fedimint', api, 0)).toBe(2000);
    expect(getRailBalance('l1', api, 0)).toBe(4000);
  });

  it('shows the custodial balance for the cashu rail when the API is available', () => {
    expect(getRailBalance('cashu', api, 1234)).toBe(40660);
  });

  it('falls back to the local cashu balance when the API is unavailable', () => {
    expect(getRailBalance('cashu', undefined, 1234)).toBe(1234);
    expect(getRailBalance('cashu', { ...api, cashu: 0 }, 1234)).toBe(0);
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

describe('getRailTileBalance', () => {
  it('shows the custodial balance on the cashu tile when the API is available', () => {
    expect(getRailTileBalance('cashu', api, 1234)).toEqual({ main: '40660 sats' });
    expect(getRailTileBalance('cashu', undefined, 1234)).toEqual({ main: '1234 sats' });
  });

  it('labels the lightning tile balance as custodial (on bao.markets)', () => {
    // The lightning panel pays via the user's external NWC/WebLN wallet and
    // its Receive creates a mint quote on the local Cashu mint — neither flow
    // touches the custodial balance, so the tile must say where those sats live.
    expect(getRailTileBalance('lightning', api, 1234)).toEqual({
      main: '1000 sats',
      sub: 'on bao.markets',
    });
  });

  it('shows — for custodial rails when API data is absent', () => {
    expect(getRailTileBalance('lightning', undefined, 1234)).toEqual({ main: '—' });
    expect(getRailTileBalance('liquid', undefined, 1234)).toEqual({ main: '—' });
  });

  it('shows the API balance without a qualifier for demo rails', () => {
    expect(getRailTileBalance('liquid', api, 1234)).toEqual({ main: '5000 sats' });
  });
});
