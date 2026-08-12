import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoutstrError, routstrCreateBalanceFromCashu, routstrTopupWithCashu, routstrGetBalance } from './routstr';

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

describe('routstrTopupWithCashu', () => {
  it('returns balance and optional amount_added/currency for a well-formed 200', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ balance: 12_000, amount_added: 7_000, currency: 'sat' }));
    await expect(routstrTopupWithCashu('sk_test_123', 'cashuAxyz')).resolves.toEqual({
      balance: 12_000,
      amountAdded: 7_000,
      currency: 'sat',
    });
  });

  it('throws on a malformed 200 with a non-numeric balance', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ balance: 'lots' }));
    await expect(routstrTopupWithCashu('sk_test_123', 'cashuAxyz')).rejects.toBeInstanceOf(RoutstrError);
    await expect(routstrTopupWithCashu('sk_test_123', 'cashuAxyz')).rejects.toThrow(/malformed top-up response/);
  });

  it('allows missing optional fields', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ balance: 5000 }));
    await expect(routstrTopupWithCashu('sk_test_123', 'cashuAxyz')).resolves.toEqual({
      balance: 5000,
      amountAdded: undefined,
      currency: undefined,
    });
  });
});

describe('routstrGetBalance', () => {
  it('returns a well-formed balance response', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ api_key: 'sk_test_123', balance: 5000, reserved: 200, total_spent: 8000, total_requests: 42 }));
    await expect(routstrGetBalance('sk_test_123')).resolves.toEqual({
      apiKey: 'sk_test_123',
      balance: 5000,
      reserved: 200,
      totalSpent: 8000,
      totalRequests: 42,
    });
  });

  it('throws on a malformed balance response', async () => {
    vi.stubGlobal('fetch', mockFetchJson({ balance: 5000 }));
    await expect(routstrGetBalance('sk_test_123')).rejects.toBeInstanceOf(RoutstrError);
    await expect(routstrGetBalance('sk_test_123')).rejects.toThrow(/malformed balance response/);
  });
});
