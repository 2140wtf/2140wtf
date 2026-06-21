import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { useBaoCashuWallet } from '@/hooks/useBaoCashuWallet';
import { usePetsNostrPublish } from '@/pets/core/hooks/usePetsNostrPublish';
import { addProfileSats } from '@/pets/core/lib/profile-sats';
import { claimBaoSignetFaucet } from '@/lib/cashu/baoFaucet';
import { devLog } from '@/lib/cashu/devLog';
import type { NUser } from '@nostrify/react/login';

export interface BaoPetStarterGrantResult {
  amount: number;
  remaining24h?: number;
  resetsAt?: number;
  profileEvent: NostrEvent;
}

interface UseBaoPetStarterGrantOptions {
  /** Called with the updated profile event after sats are credited. */
  onProfileUpdate?: (event: NostrEvent) => void;
}

/**
 * Claim BAO signet sats for a newly created pet.
 *
 * This is the shared rail for the pet starter grant. It calls the BAO faucet,
 * redeems the Cashu token into the BAO wallet, and credits the Blobbonaut
 * profile. The BAO API is responsible for the 21,400 sats / 24h rolling cap
 * per npub; the client just reports the result.
 */
export function useBaoPetStarterGrant(options: UseBaoPetStarterGrantOptions = {}) {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publishEvent } = usePetsNostrPublish();
  const { seedPhrase, available: seedAvailable } = useCashuSeed();

  const relayUrls = useMemo(() => {
    const relays = config.relayMetadata?.relays ?? [];
    return relays
      .filter((r) => r.read !== false || r.write !== false)
      .map((r) => r.url);
  }, [config.relayMetadata?.relays]);

  const baoWalletUser: NUser | null = useMemo(() => {
    if (!user?.pubkey || !user?.signer) return null;
    return user;
  }, [user]);

  // useBaoCashuWallet must be called unconditionally. When the user or seed is
  // not ready the wallet simply won't operate; the mutation below guards the
  // actual claim.
  const baoWallet = useBaoCashuWallet(
    seedPhrase ?? '',
    baoWalletUser ?? ({ pubkey: '', signer: undefined } as unknown as NUser),
    relayUrls,
  );

  return useMutation({
    mutationFn: async (amount: number): Promise<BaoPetStarterGrantResult> => {
      if (!user?.pubkey) throw new Error('You must be logged in to claim starter sats.');
      if (!seedAvailable || !seedPhrase) {
        throw new Error('Cashu seed is not available; make sure your signer supports NIP-44.');
      }
      const faucetUrl = config.baoSignetFaucetUrl?.trim();
      if (!faucetUrl) throw new Error('BAO faucet is not configured.');

      const npub = nip19.npubEncode(user.pubkey);
      const res = await claimBaoSignetFaucet(faucetUrl, { npub, amount });

      if (!res?.token) {
        const reason = res?.message || 'BAO faucet did not return a token.';
        throw new Error(reason);
      }

      await baoWallet.receiveToken(res.token.trim());

      const { event } = await addProfileSats(nostr, publishEvent, user.pubkey, amount);

      return {
        amount,
        remaining24h: res.remaining24h,
        resetsAt: res.resetsAt,
        profileEvent: event,
      };
    },
    onSuccess: (result) => {
      options.onProfileUpdate?.(result.profileEvent);
      devLog.log(`BAO starter grant credited ${result.amount} sats to pet profile`);
    },
    onError: (error: Error) => {
      // The faucet returns user-facing messages (e.g. daily limit reached).
      // Avoid noisy toasts here; callers can surface them if they want.
      devLog.warn('BAO pet starter grant failed:', error.message);
    },
  });
}
