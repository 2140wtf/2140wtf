import { useQuery } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fetchBaoWalletBalances, type BaoWalletBalances } from '@/lib/baoWalletApi';

/**
 * The user's custodial balances on bao.markets, per rail.
 *
 * These sats live in the bao.markets ledger, not in the local NIP-60 ecash
 * wallet, so this is the only way the client can show them. Auth is NIP-98
 * (sign-only) — works with nsec, NIP-07 and NIP-46 bunker logins alike.
 */
export function useBaoWalletBalances() {
  const { user } = useCurrentUser();

  return useQuery<BaoWalletBalances>({
    queryKey: ['bao-wallet-balances', user?.pubkey],
    enabled: !!user,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: () => fetchBaoWalletBalances(user!.signer),
  });
}
