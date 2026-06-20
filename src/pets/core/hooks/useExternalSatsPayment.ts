import { useCallback } from 'react';

import { toast } from '@/hooks/useToast';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';

export interface UseExternalSatsPaymentResult {
  /** Pay a cost in real BTC sats from the external Cashu wallet. Returns the generated Cashu token on success. */
  paySats: (amount: number, memo?: string) => Promise<string>;
}

/**
 * Helper to pay Pets economy costs with an external Cashu wallet.
 *
 * In `btc-sats` wallet mode, shop/adoption costs are settled by sending a Cashu
 * token from the user's external wallet. The token is returned to the caller;
 * the Pets module treats it as a burn and updates the in-game `sats` ledger.
 */
export function useExternalSatsPayment(
  externalWallet: (CashuWalletState & CashuWalletActions) | null | undefined,
): UseExternalSatsPaymentResult {
  const paySats = useCallback(
    async (amount: number, memo = ''): Promise<string> => {
      if (!externalWallet) {
        throw new Error('External wallet is not available.');
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error(`Invalid payment amount: ${amount}`);
      }

      if (externalWallet.totalBalance < amount) {
        throw new Error(
          `Insufficient external wallet balance. You need ${amount} sats but only have ${externalWallet.totalBalance}.`,
        );
      }

      const token = await externalWallet.sendToken(amount, memo);
      if (!token) {
        throw new Error('External payment failed. Please check your wallet and try again.');
      }

      return token;
    },
    [externalWallet],
  );

  return { paySats };
}

/**
 * Convenience wrapper for one-off external sats payments outside of React components.
 * Prefer `useExternalSatsPayment` in hooks/components.
 */
export async function paySatsWithWallet(
  externalWallet: (CashuWalletState & CashuWalletActions) | null | undefined,
  amount: number,
  memo = '',
): Promise<string> {
  if (!externalWallet) {
    throw new Error('External wallet is not available.');
  }

  if (externalWallet.totalBalance < amount) {
    toast({
      title: 'Insufficient external wallet balance',
      description: `You need ${amount} sats but only have ${externalWallet.totalBalance}.`,
      variant: 'destructive',
    });
    throw new Error('Insufficient external wallet balance');
  }

  const token = await externalWallet.sendToken(amount, memo);
  if (!token) {
    throw new Error('External payment failed');
  }

  return token;
}
