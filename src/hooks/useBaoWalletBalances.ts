import { useEffect } from 'react';
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

  const { refetch, ...query } = useQuery<BaoWalletBalances>({
    queryKey: ['bao-wallet-balances', user?.pubkey],
    enabled: !!user,
    staleTime: 15_000,
    // Fetch immediately when the BAO tab mounts. The scheduled refreshes below
    // are deliberately sparse; the wallet's refresh button remains available
    // for an on-demand update.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    queryFn: () => fetchBaoWalletBalances(user!.signer),
  });

  useEffect(() => {
    if (!user?.pubkey) return;

    let cancelled = false;
    let hourlyTimer: ReturnType<typeof setInterval> | undefined;
    const thirtySecondTimer = setTimeout(() => {
      void refetch().finally(() => {
        if (!cancelled) {
          hourlyTimer = setInterval(() => {
            void refetch();
          }, 60 * 60_000);
        }
      });
    }, 30_000);

    return () => {
      cancelled = true;
      clearTimeout(thirtySecondTimer);
      if (hourlyTimer) clearInterval(hourlyTimer);
    };
  }, [refetch, user?.pubkey]);

  return { ...query, refetch };
}
