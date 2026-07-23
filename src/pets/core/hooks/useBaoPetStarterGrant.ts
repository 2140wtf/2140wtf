import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { useBaoCashuWallet } from '@/hooks/useBaoCashuWallet';
import { claimBaoSignetFaucet, clampBaoFaucetAmount, isBaoFaucetDailyExhausted } from '@/lib/cashu/baoFaucet';
import { decodeCashuToken } from '@/lib/cashu/cashu';
import { devLog } from '@/lib/cashu/devLog';
import type { NUser } from '@nostrify/react/login';

export interface BaoPetStarterGrantResult {
  amount: number;
  remaining24h?: number;
  resetsAt?: number;
}

interface UseBaoPetStarterGrantOptions {
  /** Called with the grant result after the BAO wallet is credited. */
  onCredited?: (result: BaoPetStarterGrantResult) => void;
  /** If false, the BAO wallet is kept idle and the mutation will throw. Default true. */
  enabled?: boolean;
}

/**
 * Claim BAO signet sats for a newly created pet.
 *
 * Calls the BAO faucet and redeems the Cashu token into the BAO signet
 * wallet (the demo cashu rail). The balance is read back from the wallet
 * itself — nothing is mirrored into the Nostr pet profile `sats` tag.
 * The BAO API is responsible for the 21,400 sats / 24h rolling cap per
 * npub; the client just reports the result.
 */
export function useBaoPetStarterGrant(options: UseBaoPetStarterGrantOptions = {}) {
  const { onCredited, enabled = true } = options;
  const { config } = useAppContext();
  const { user } = useCurrentUser();
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
    { enableAutoClaim: enabled },
  );

  return useMutation({
    mutationFn: async (amount: number): Promise<BaoPetStarterGrantResult> => {
      if (!enabled) throw new Error('₿AO starter grant is disabled in real-money mode.');
      if (!user?.pubkey) throw new Error('You must be logged in to claim starter sats.');
      if (!seedAvailable || !seedPhrase) {
        throw new Error('Cashu seed is not available; make sure your signer supports NIP-44.');
      }
      const faucetUrl = config.baoSignetFaucetUrl?.trim();
      if (!faucetUrl) throw new Error('₿AO faucet is not configured.');

      const npub = nip19.npubEncode(user.pubkey);
      const requestAmount = clampBaoFaucetAmount(amount);
      if (requestAmount <= 0) {
        throw new Error('₿AO daily claim amount is too small or exhausted.');
      }
      const res = await claimBaoSignetFaucet(faucetUrl, { npub, amount: requestAmount });

      if (!res?.token) {
        const reason = res?.message || '₿AO faucet did not return a token.';
        throw new Error(reason);
      }
      if (isBaoFaucetDailyExhausted(res)) {
        throw new Error(res.message ?? '₿AO 24h limit reached. Try again later.');
      }

      await baoWallet.receiveToken(res.token.trim());

      // Report the actual decoded token amount, capped to the faucet's 24h report.
      const decoded = decodeCashuToken(res.token.trim());
      const depositedSats = decoded?.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
      const creditedAmount = clampBaoFaucetAmount(depositedSats, res.remaining24h);
      if (creditedAmount <= 0) {
        throw new Error(res.message ?? '₿AO faucet returned an empty token.');
      }

      return {
        amount: creditedAmount,
        remaining24h: res.remaining24h,
        resetsAt: res.resetsAt,
      };
    },
    onSuccess: (result) => {
      onCredited?.(result);
      devLog.log(`BAO starter grant credited ${result.amount} sats to the BAO wallet`);
    },
    onError: (error: Error) => {
      // The faucet returns user-facing messages (e.g. daily limit reached).
      // Avoid noisy toasts here; callers can surface them if they want.
      devLog.warn('BAO pet starter grant failed:', error.message);
    },
  });
}
