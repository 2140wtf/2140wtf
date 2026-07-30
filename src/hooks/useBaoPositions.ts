import { useQuery } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fetchBaoPositions, type BaoPosition } from '@/lib/baoWalletApi';

/**
 * The logged-in user's open positions on bao.markets ("my trades"),
 * refreshed every 60s. Signed per request with the user's NIP-98 header
 * (cached ~2 min, so no signer spam).
 */
export function useBaoPositions() {
  const { user } = useCurrentUser();

  return useQuery<BaoPosition[]>({
    queryKey: ['bao-positions', user?.pubkey],
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: () => fetchBaoPositions(user!.signer),
  });
}
