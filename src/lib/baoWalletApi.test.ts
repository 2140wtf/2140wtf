import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkBaoCashuClaimStatus,
  claimBaoCashu,
  clearPendingBaoCashuTokens,
  fetchBaoWalletBalances,
  fetchPendingBaoCashuTokens,
  totalBaoApiBalance,
} from './baoWalletApi';
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

describe('BAO Cashu claim and collection API', () => {
  it('binds a Cashu claim authorization to the exact request body', async () => {
    const spy = mockFetchOnce(202, {
      data: { status: 'pending', idempotency_key: 'claim-key' },
    });

    await expect(claimBaoCashu(fakeSigner, 2_140, 'claim-key')).resolves.toEqual({
      status: 'pending',
      idempotency_key: 'claim-key',
      claimed_sats: undefined,
      new_balance_sats: undefined,
      txid: undefined,
    });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://relay.bao.network/bao-api/v1/wallet/claim');
    expect(init.body).toBe(JSON.stringify({ rail: 'cashu', amount_sats: 2_140, idempotency_key: 'claim-key' }));
    const auth = String((init.headers as Record<string, string>).Authorization);
    const event = JSON.parse(atob(auth.slice(6))) as { tags: string[][] };
    expect(event.tags).toContainEqual(['u', url]);
    expect(event.tags).toContainEqual(['method', 'POST']);
    expect(event.tags.some(([name, value]) => name === 'payload' && value.length === 64)).toBe(true);
  });

  it('parses a completed asynchronous claim status', async () => {
    mockFetchOnce(200, {
      data: {
        status: 'completed',
        idempotency_key: 'claim-key',
        result: { claimed_sats: 2_140, new_balance_sats: 7_040, txid: 'cashu-event' },
      },
    });

    await expect(checkBaoCashuClaimStatus(fakeSigner, 'claim-key')).resolves.toEqual({
      status: 'completed',
      idempotency_key: 'claim-key',
      claimed_sats: 2_140,
      new_balance_sats: 7_040,
      txid: 'cashu-event',
    });
  });

  it('surfaces a failed asynchronous claim instead of polling forever', async () => {
    mockFetchOnce(200, {
      data: { status: 'failed', idempotency_key: 'claim-key', result: { error: 'Mint unavailable' } },
    });

    await expect(checkBaoCashuClaimStatus(fakeSigner, 'claim-key')).rejects.toMatchObject({
      message: 'Mint unavailable',
      code: 'CLAIM_FAILED',
    });
  });

  it('parses a claim completed directly by the POST endpoint', async () => {
    mockFetchOnce(200, {
      data: { idempotency_key: 'claim-key', claimed_sats: 21, new_balance_sats: 42, txid: 'minted-token' },
    });

    await expect(claimBaoCashu(fakeSigner, 21, 'claim-key')).resolves.toEqual({
      status: 'completed',
      idempotency_key: 'claim-key',
      claimed_sats: 21,
      new_balance_sats: 42,
      txid: 'minted-token',
    });
  });

  it('fetches and clears only valid pending token strings', async () => {
    const idA = 'a'.repeat(64);
    const idB = 'b'.repeat(64);
    const fetchSpy = mockFetchOnce(200, { data: { items: [
      { id: idA, token: 'cashuA-token' },
      { id: 'bad', token: 'cashu-invalid' },
      { id: idB, token: 'cashuB-token' },
    ] } });
    await expect(fetchPendingBaoCashuTokens(fakeSigner)).resolves.toEqual([
      { id: idA, token: 'cashuA-token' },
      { id: idB, token: 'cashuB-token' },
    ]);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://relay.bao.network/bao-api/v1/wallet/cashu-pending');

    const clearSpy = mockFetchOnce(200, { data: { collected: true } });
    await expect(clearPendingBaoCashuTokens(fakeSigner, [idA, idB])).resolves.toBeUndefined();
    const [url, init] = clearSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe('https://relay.bao.network/bao-api/v1/wallet/cashu-collect');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ token_ids: [idA, idB] }));
    const auth = String((init.headers as Record<string, string>).Authorization);
    const event = JSON.parse(atob(auth.slice(6))) as { tags: string[][] };
    expect(event.tags.some(([name, value]) => name === 'payload' && value.length === 64)).toBe(true);
  });
});
