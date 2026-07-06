// src/pets/core/hooks/usePetsStarterGrant.ts
//
// Starter grant for a newly hatched pet. In testnet mode it claims BAO signet
// sats from the faucet; in real mode it credits fake/demo starter sats to the
// profile so the pet can live for free until the user decides to top up the
// real Cashu wallet.

import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { useBaoPetStarterGrant } from '@/pets/core/hooks/useBaoPetStarterGrant';
import { usePetsWallet } from '@/pets/core/hooks/usePetsWallet';
import { addProfileSats } from '@/pets/core/lib/profile-sats';
import { devLog } from '@/lib/cashu/devLog';

export interface PetsStarterGrantResult {
  amount: number;
  profileEvent: NostrEvent;
}

interface UsePetsStarterGrantOptions {
  onProfileUpdate?: (event: NostrEvent) => void;
}

/**
 * Hook to award starter sats to a new pet.
 *
 * - Testnet mode: claims from the BAO faucet via `useBaoPetStarterGrant`.
 * - Real mode: credits `amount` fake sats to the Blobbonaut profile without
 *   touching the BAO faucet.
 */
export function usePetsStarterGrant(options: UsePetsStarterGrantOptions = {}) {
  const { onProfileUpdate } = options;
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const { isTestnet } = usePetsWallet();

  const baoGrant = useBaoPetStarterGrant({
    onProfileUpdate,
    enabled: isTestnet,
  });

  return useMutation<PetsStarterGrantResult, Error, number>({
    mutationFn: async (amount: number) => {
      if (!user?.pubkey) {
        throw new Error('You must be logged in to claim starter sats.');
      }

      if (isTestnet) {
        const result = await baoGrant.mutateAsync(amount);
        return {
          amount: result.amount,
          profileEvent: result.profileEvent,
        };
      }

      // Real mode: credit fake/demo starter sats directly to the profile.
      const { event } = await addProfileSats(nostr, publishEvent, user.pubkey, amount);
      onProfileUpdate?.(event);
      devLog.log(`Real-mode starter grant credited ${amount} fake sats to pet profile`);
      return { amount, profileEvent: event };
    },
    onError: (error: Error) => {
      devLog.warn('Pets starter grant failed:', error.message);
    },
  });
}
