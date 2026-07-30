import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoutstrError, routstrCreateBalanceFromCashu } from './routstr';

function mockFetchJson(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(body === null ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routstrCreateBalanceFromCashu', () => {
  it('returns the API key and balance for a well-formed 200', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ api_key: 'sk_test_123', balance: 5000 }));
    await expect(routstrCreateBalanceFromCashu('cashuAxyz')).resolves.toEqual({
      apiKey: 'sk_test_123',
      balance: 5000,
    });
  });

  it('throws RoutstrError on a malformed 200 (missing api_key) instead of losing the key', async () => {
    // Routstr redeems the token server-side BEFORE responding — treating a
    // shapeless 200 as success would strand the sats under an unknown key.
    vi.stubGlobal('fetch', mockFetchJson({}));
    await expect(routstrCreateBalanceFromCashu('cashuAxyz')).rejects.toBeInstanceOf(RoutstrError);
    await expect(routstrCreateBalanceFromCashu('cashuAxyz')).rejects.toThrow(/malformed response/);
  });

  it('throws RoutstrError on a 200 with a non-JSON / empty body', async () => {
    vi.stubGlobal('fetch', mockFetchJson(null));
    await expect(routstrCreateBalanceFromCashu('cashuAxyz')).rejects.toBeInstanceOf(RoutstrError);
  });

  it('throws RoutstrError when api_key is empty or balance is not a number', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ api_key: '', balance: 100 }));
    await expect(routstrCreateBalanceFromCashu('cashuAxyz')).rejects.toBeInstanceOf(RoutstrError);

    vi.stubGlobal('fetch', mockFetchJson({ api_key: 'sk_x', balance: '100' }));
    await expect(routstrCreateBalanceFromCashu('cashuAxyz')).rejects.toBeInstanceOf(RoutstrError);
  });

  it('surfaces the server error message on a non-OK status', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ error: { message: 'token already redeemed' } }, 400));
    await expect(routstrCreateBalanceFromCashu('cashuAxyz')).rejects.toThrow('token already redeemed');
  });
});
