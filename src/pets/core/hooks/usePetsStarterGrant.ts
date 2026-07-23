// src/pets/core/hooks/usePetsStarterGrant.ts
//
// Starter grant for a newly hatched pet, BAO demo mode only: claims BAO
// signet sats from the faucet into the BAO signet Cashu wallet. Mainnet
// (cashu) mode has no starter grant — real sats are never minted for free.

import { useMutation } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBaoPetStarterGrant, type BaoPetStarterGrantResult } from '@/pets/core/hooks/useBaoPetStarterGrant';
import { usePetsWallet } from '@/pets/core/hooks/usePetsWallet';
import { devLog } from '@/lib/cashu/devLog';

export type PetsStarterGrantResult = BaoPetStarterGrantResult;

interface UsePetsStarterGrantOptions {
  /** Called with the grant result after the BAO wallet is credited. */
  onCredited?: (result: PetsStarterGrantResult) => void;
}

/**
 * Hook to award starter sats to a new pet.
 *
 * Demo (BAO) mode only: claims from the BAO faucet via `useBaoPetStarterGrant`.
 * In mainnet (cashu) mode the mutation throws — never call it there.
 */
export function usePetsStarterGrant(options: UsePetsStarterGrantOptions = {}) {
  const { onCredited } = options;
  const { user } = useCurrentUser();
  const { isBao } = usePetsWallet();

  const baoGrant = useBaoPetStarterGrant({
    onCredited,
    enabled: isBao,
  });

  return useMutation<PetsStarterGrantResult, Error, number>({
    mutationFn: async (amount: number) => {
      if (!user?.pubkey) {
        throw new Error('You must be logged in to claim starter sats.');
      }

      if (!isBao) {
        throw new Error('Starter grants are only available in ₿AO demo mode.');
      }

      return baoGrant.mutateAsync(amount);
    },
    onError: (error: Error) => {
      devLog.warn('Pets starter grant failed:', error.message);
    },
  });
}
