import { useCallback } from 'react';

import { toast } from '@/hooks/useToast';
import type { CashuWalletActions, CashuWalletState } from '@/hooks/useCashuWallet';

export interface UseBaoPaymentResult {
  /** Pay a cost in BAO signet/demo sats. Returns the generated Cashu token on success. */
  payBaoSats: (amount: number, memo?: string) => Promise<string>;
}

/**
 * Helper to pay Pets economy costs with the BAO signet Cashu wallet.
 *
 * The generated Cashu token is returned to the caller. In the current design it
 * is treated as a signet burn (discarded); a BAO treasury recipient can be added
 * later once the backend contract is defined.
 */
export function useBaoPayment(
  baoWallet: (CashuWalletState & CashuWalletActions) | null | undefined,
): UseBaoPaymentResult {
  const payBaoSats = useCallback(
    async (amount: number, memo = ''): Promise<string> => {
      if (!baoWallet) {
        throw new Error('BAO wallet is not available.');
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error(`Invalid BAO payment amount: ${amount}`);
      }

      if (baoWallet.totalBalance < amount) {
        throw new Error(
          `Insufficient BAO balance. You need ${amount} sats but only have ${baoWallet.totalBalance}.`,
        );
      }

      const token = await baoWallet.sendToken(amount, memo);
      if (!token) {
        throw new Error('BAO payment failed. Please check your wallet and try again.');
      }

      return token;
    },
    [baoWallet],
  );

  return { payBaoSats };
}

/**
 * Convenience wrapper for one-off BAO payments outside of React components.
 * Prefer `useBaoPayment` in hooks/components.
 */
export async function payBaoSatsWithWallet(
  baoWallet: (CashuWalletState & CashuWalletActions) | null | undefined,
  amount: number,
  memo = '',
): Promise<string> {
  if (!baoWallet) {
    throw new Error('BAO wallet is not available.');
  }

  if (baoWallet.totalBalance < amount) {
    toast({
      title: 'Insufficient BAO balance',
      description: `You need ${amount} sats but only have ${baoWallet.totalBalance}.`,
      variant: 'destructive',
    });
    throw new Error('Insufficient BAO balance');
  }

  const token = await baoWallet.sendToken(amount, memo);
  if (!token) {
    throw new Error('BAO payment failed');
  }

  return token;
}
