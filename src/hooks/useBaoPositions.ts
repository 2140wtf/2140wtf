import { useQuery } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { fetchBaoPositions, fetchBaoSmjPositions, type BaoPosition } from '@/lib/baoWalletApi';

/**
 * The logged-in user's open positions on bao.markets ("my trades") — CLOB/AMM
 * positions merged with SMJ parimutuel bets, refreshed every 60s. Signed per
 * request with the user's NIP-98 header (cached ~2 min, so no signer spam).
 */
export function useBaoPositions() {
  const { user } = useCurrentUser();

  return useQuery<BaoPosition[]>({
    queryKey: ['bao-positions', user?.pubkey],
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async () => {
      const [clob, smj] = await Promise.all([
        fetchBaoPositions(user!.signer),
        fetchBaoSmjPositions(user!.signer).catch(() => []),
      ]);
      return [...clob, ...smj].sort((a, b) => b.updated_at - a.updated_at);
    },
  });
}
