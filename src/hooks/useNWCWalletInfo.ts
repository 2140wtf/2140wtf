import { useQuery } from '@tanstack/react-query';
import { LN } from '@getalby/sdk';

import { validateNwcUri } from '@/hooks/useNWC';

const CALL_TIMEOUT_MS = 10_000;

export interface NWCWalletInfo {
  /** Service alias from get_info (e.g. "Rizful"). */
  serviceAlias?: string;
  /** Wallet balance in sats (NIP-47 get_balance returns msats). */
  balanceSats?: number;
  /** NIP-47 methods the service supports. */
  methods?: string[];
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), CALL_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

/**
 * Fetch get_info + get_balance from an NWC wallet service (Rizful, Alby,
 * Coinos, …). Each call is optional — older services may not implement them,
 * so failures degrade to a partial result rather than an error.
 */
async function fetchNWCWalletInfo(connectionString: string): Promise<NWCWalletInfo> {
  const ln = new LN(connectionString);
  const result: NWCWalletInfo = {};
  try {
    try {
      const info = await withTimeout(ln.nwcClient.getInfo(), 'get_info');
      result.serviceAlias = info.alias || undefined;
      result.methods = info.methods;
    } catch {
      // get_info unsupported or unreachable — fall through to balance.
    }
    try {
      const { balance } = await withTimeout(ln.nwcClient.getBalance(), 'get_balance');
      // NIP-47 get_balance is denominated in msats.
      result.balanceSats = Math.floor(balance / 1000);
    } catch {
      // get_balance unsupported — the connection still pays invoices.
    }
  } finally {
    ln.close();
  }
  return result;
}

/**
 * Live info for one NWC connection: service alias and balance, refreshed
 * periodically. Keyed by the wallet-service pubkey so the secret-bearing
 * connection string never lands in the query cache.
 */
export function useNWCWalletInfo(connectionString: string | undefined) {
  const parsed = connectionString ? validateNwcUri(connectionString) : null;

  return useQuery({
    queryKey: ['nwc-wallet-info', parsed?.pubkey],
    queryFn: () => fetchNWCWalletInfo(connectionString!),
    enabled: !!parsed,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
