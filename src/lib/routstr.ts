/**
 * Routstr API client (browser-safe).
 *
 * Routstr (https://routstr.com) turns Cashu ecash into AI-compute credits:
 * you redeem a Cashu token for an `sk_…` API key whose balance is metered in
 * sats against any OpenAI-compatible model the node serves.
 *
 * This is the REAL-money half of the ₿AO Fund page (mainnet sats, tokens
 * only — no lightning invoices here). Ported from the node-side client in
 * bfi_terminal; plain fetch only, no bolt11/node deps, no mock mode.
 */

export const ROUTSTR_BASE_URL: string =
  (import.meta.env.VITE_ROUTSTR_API_URL as string | undefined)?.replace(/\/+$/, '')
  || 'https://api.routstr.com';

export class RoutstrError extends Error {
  status?: number;
  constructor(message: string, opts?: { status?: number }) {
    super(message);
    this.name = 'RoutstrError';
    this.status = opts?.status;
  }
}

async function routstrFetch<T>(method: string, path: string, body?: unknown, authKey?: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authKey) headers.Authorization = `Bearer ${authKey}`;

  const res = await fetch(`${ROUTSTR_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as { error?: { message?: string } | string } | null)?.error;
    const msg = typeof err === 'string' ? err : err?.message ?? `Routstr API returned ${res.status}`;
    throw new RoutstrError(msg, { status: res.status });
  }
  return json as T;
}

export interface RoutstrNodeInfo {
  name?: string;
  description?: string;
  version?: string;
  npub?: string;
  /** Cashu mints this node accepts for top-ups. */
  mints?: string[];
  http_url?: string;
}

/** Node metadata — which models/mints the node serves. */
export async function routstrGetInfo(): Promise<RoutstrNodeInfo> {
  return routstrFetch<RoutstrNodeInfo>('GET', '/v1/info');
}

export interface RoutstrBalance {
  apiKey: string;
  /** Remaining balance (msats on most nodes). */
  balance: number;
  reserved?: number;
  totalSpent?: number;
  totalRequests?: number;
}

/**
 * Redeem a Cashu token into a fresh Routstr API key.
 * Returns the `sk_…` key — whoever holds it can spend the balance, so it is
 * shown once and never sent over Nostr.
 *
 * The response shape is validated: Routstr redeems the token server-side
 * BEFORE responding, so a malformed 200 (proxy rewrite, renamed fields, an
 * empty body) must NOT be treated as success — the proofs are spent and the
 * `sk_` key would be silently lost. Throwing routes the caller into its
 * recovery path (receive-back + mint spent-check) instead.
 */
export async function routstrCreateBalanceFromCashu(cashuToken: string): Promise<{ apiKey: string; balance: number }> {
  const res = await routstrFetch<{ api_key?: unknown; balance?: unknown }>(
    'GET',
    `/v1/balance/create?initial_balance_token=${encodeURIComponent(cashuToken)}`,
  );
  if (
    !res ||
    typeof res.api_key !== 'string' ||
    res.api_key.length === 0 ||
    typeof res.balance !== 'number' ||
    !Number.isFinite(res.balance)
  ) {
    throw new RoutstrError('Routstr returned a malformed response after the redeem — the token may have been redeemed but the API key was not delivered.');
  }
  return { apiKey: res.api_key, balance: res.balance };
}

/** Top up an existing Routstr key with another Cashu token. */
export async function routstrTopupWithCashu(
  apiKey: string,
  cashuToken: string,
): Promise<{ balance: number; amountAdded?: number; currency?: string }> {
  const res = await routstrFetch<{ balance: number; amount_added?: number; currency?: string }>(
    'POST',
    '/v1/balance/topup',
    { cashu_token: cashuToken },
    apiKey,
  );
  return { balance: res.balance, amountAdded: res.amount_added, currency: res.currency };
}

/** Read the balance of an existing Routstr key. */
export async function routstrGetBalance(apiKey: string): Promise<RoutstrBalance> {
  const res = await routstrFetch<{
    api_key: string;
    balance: number;
    reserved?: number;
    total_spent?: number;
    total_requests?: number;
  }>('GET', '/v1/balance/info', undefined, apiKey);
  return {
    apiKey: res.api_key,
    balance: res.balance,
    reserved: res.reserved,
    totalSpent: res.total_spent,
    totalRequests: res.total_requests,
  };
}
