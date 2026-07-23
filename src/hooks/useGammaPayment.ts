import { useCallback } from 'react';

import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { useNWC } from '@/hooks/useNWCContext';
import { useWallet } from '@/hooks/useWallet';
import type { GammaPaymentOption } from '@/lib/gammaMarkets';

export type GammaPaymentKind = 'bolt11' | 'bolt12' | 'bitcoin' | 'ecash' | 'unknown';

export interface GammaPaymentResult {
  success: boolean;
  amountSats: number;
  proof?: string;
  pending?: boolean;
  /** True when no automated rail is available; the caller should collect proof manually. */
  manual?: boolean;
}

/**
 * Detect the concrete payment type from a Gamma payment option value.
 *
 * The Gamma `medium` tag is coarse (lightning/bitcoin/ecash/fiat), so we look
 * at the actual value to decide whether we can pay it automatically.
 */
export function detectGammaPaymentKind(option: GammaPaymentOption): GammaPaymentKind {
  const v = option.value.trim().toLowerCase();
  if (v.startsWith('lno1')) return 'bolt12';
  if (v.startsWith('ln')) return 'bolt11';
  if (v.startsWith('bc1') || v.startsWith('1') || v.startsWith('3') || v.startsWith('sp1')) {
    return 'bitcoin';
  }
  if (v.startsWith('cashu') || v.startsWith('http')) return 'ecash';
  return 'unknown';
}

/**
 * Execute a Gamma Markets payment option and return a proof suitable for a
 * kind 17 receipt.
 *
 * Preference order:
 *   1. Nostr Wallet Connect (NWC) for BOLT11 invoices.
 *   2. WebLN for BOLT11 invoices.
 *   3. Cashu wallet for BOLT11 invoices or BOLT12 offers.
 *
 * For Bitcoin on-chain, ecash, and unsupported values the hook returns a
 * `manual` result so the UI can ask the user for the proof (txid, token, …).
 */
export function useGammaPayment() {
  const { hasNWC, webln, activeNWC } = useWallet();
  const { sendPayment: sendNwcPayment } = useNWC();
  const cashu = useCashuWalletContext();

  const pay = useCallback(
    async (option: GammaPaymentOption, amountSats: number): Promise<GammaPaymentResult> => {
      const kind = detectGammaPaymentKind(option);
      const value = option.value.trim();

      if (kind === 'bolt11') {
        if (activeNWC) {
          const result = await sendNwcPayment(activeNWC, value);
          return { success: true, amountSats, proof: result.preimage };
        }
        if (webln?.sendPayment) {
          await webln.sendPayment(value);
          return { success: true, amountSats, proof: 'webln' };
        }
        if (cashu.seedAvailable) {
          const result = await cashu.payInvoice(value);
          if (result.success) {
            return { success: true, amountSats, proof: result.preimage ?? 'cashu', pending: result.pending };
          }
          throw new Error('Cashu invoice payment failed');
        }
        return { success: false, amountSats, manual: true };
      }

      if (kind === 'bolt12') {
        if (cashu.seedAvailable) {
          const result = await cashu.payBolt12(value, amountSats);
          if (result.success) {
            const proof =
              (result.quote && 'payment_preimage' in result.quote && typeof result.quote.payment_preimage === 'string'
                ? result.quote.payment_preimage
                : undefined) ??
              (result.quote && 'quote' in result.quote && typeof result.quote.quote === 'string'
                ? result.quote.quote
                : undefined) ??
              'bolt12';
            return { success: true, amountSats, proof, pending: result.pending };
          }
          throw new Error('BOLT12 payment failed');
        }
        return { success: false, amountSats, manual: true };
      }

      // Bitcoin on-chain and ecash require external action + manual proof entry.
      return { success: false, amountSats, manual: true };
    },
    [activeNWC, webln, cashu, sendNwcPayment],
  );

  const canPay = useCallback(
    (option: GammaPaymentOption) => {
      const kind = detectGammaPaymentKind(option);
      if (kind === 'bolt11') return hasNWC || !!webln?.sendPayment || cashu.seedAvailable;
      if (kind === 'bolt12') return cashu.seedAvailable;
      return false;
    },
    [hasNWC, webln, cashu],
  );

  return { pay, canPay, detectKind: detectGammaPaymentKind };
}
