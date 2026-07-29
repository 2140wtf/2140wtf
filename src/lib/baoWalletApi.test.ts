import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchBaoWalletBalances, totalBaoApiBalance } from './baoWalletApi';
import type { BaoApiSigner } from './baoApiAuth';

const fakeSigner: BaoApiSigner = {
  signEvent: (event) =>
    Promise.resolve({
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      sig: 'c'.repeat(128),
      ...event,
    }),
};

function mockFetchOnce(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchBaoWalletBalances', () => {
  it('sends a NIP-98 Authorization header for the balance URL', async () => {
    const spy = mockFetchOnce(200, { data: {} });

    await fetchBaoWalletBalances(fakeSigner);

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://relay.bao.network/bao-api/v1/wallet/balance');
    const auth = String((init.headers as Record<string, string>).Authorization);
    expect(auth.startsWith('Nostr ')).toBe(true);
    const event = JSON.parse(atob(auth.slice(6)));
    expect(event.kind).toBe(27235);
    expect(event.tags).toContainEqual(['u', url]);
    expect(event.tags).toContainEqual(['method', 'GET']);
  });

  it('parses per-rail sats from the response envelope', async () => {
    mockFetchOnce(200, {
      data: {
        lightning: { sats: 2140 },
        ecash: { sats: 0 },
        cashu: { sats: 500 },
        spark: { sats: 42 },
        l1: { sats: 0 },
        liquid: { sats: 100 },
        ark: { sats: 0 },
      },
    });

    const balances = await fetchBaoWalletBalances(fakeSigner);
    expect(balances).toEqual({
      lightning: 2140,
      ecash: 0,
      cashu: 500,
      spark: 42,
      l1: 0,
      liquid: 100,
      ark: 0,
    });
    expect(totalBaoApiBalance(balances)).toBe(2782);
  });

  it('treats missing rails and malformed sats as zero', async () => {
    mockFetchOnce(200, { data: { lightning: { sats: 'not-a-number' }, spark: { sats: -5 } } });

    const balances = await fetchBaoWalletBalances(fakeSigner);
    expect(totalBaoApiBalance(balances)).toBe(0);
  });

  it('throws the API error message on non-OK responses', async () => {
    mockFetchOnce(401, { error: { message: 'unauthorized' } });

    await expect(fetchBaoWalletBalances(fakeSigner)).rejects.toThrow('unauthorized');
  });
});
