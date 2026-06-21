import { devLog } from '@/lib/cashu/devLog';

export interface BaoFaucetRequest {
  /** User npub to associate with the faucet grant. */
  npub: string;
  /** Amount in signet/demo sats. */
  amount: number;
}

export interface BaoFaucetResponse {
  /** Cashu token string that can be received by the wallet. */
  token?: string;
  /** Human-readable status message from the faucet. */
  message?: string;
  /** Remaining sats the caller can claim in the current 24h rolling window. */
  remaining24h?: number;
  /** Unix timestamp (seconds) when the 24h rolling window resets. */
  resetsAt?: number;
}

/**
 * Claim signet/demo sats from the BAO faucet.
 *
 * The expected contract is a POST to the faucet URL with a JSON body
 * `{ npub, amount }` and a JSON response `{ token?: string, message?: string }`.
 * The returned Cashu token is then redeemed by the wallet.
 */
export async function claimBaoSignetFaucet(
  endpoint: string,
  request: BaoFaucetRequest,
): Promise<BaoFaucetResponse | null> {
  const url = endpoint.trim();
  if (!url) {
    devLog.warn('BAO faucet URL is not configured');
    return null;
  }
  if (!request.npub || !request.amount || request.amount <= 0) {
    devLog.warn('Invalid BAO faucet request:', request);
    return null;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      devLog.warn('BAO faucet returned error:', response.status, text);
      return null;
    }
    const json = (await response.json()) as unknown;
    if (!json || typeof json !== 'object') return null;
    const obj = json as Record<string, unknown>;
    const { token, message, remaining24h, resetsAt } = obj;
    return {
      token: typeof token === 'string' ? token : undefined,
      message: typeof message === 'string' ? message : undefined,
      remaining24h: typeof remaining24h === 'number' ? remaining24h : undefined,
      resetsAt: typeof resetsAt === 'number' ? resetsAt : undefined,
    };
  } catch (e) {
    devLog.error('BAO faucet request failed:', e);
    return null;
  }
}
