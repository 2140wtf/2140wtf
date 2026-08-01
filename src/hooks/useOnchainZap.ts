import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { verifyEvent } from 'nostr-tools';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBitcoinSigner, isSignerCapabilityError, reportSignerUnsupported } from '@/hooks/useBitcoinSigner';
import { useBitcoinWallet } from '@/hooks/useBitcoinWallet';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { usePublishPreferences } from './usePublishPreferences';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { notificationSuccess } from '@/lib/haptics';
import {
  nostrPubkeyToBitcoinAddress,
  fetchUTXOs,
  getFeeRates,
  buildUnsignedPsbt,
  buildUnsignedPsbtHd,
  buildUnsignedSilentPaymentPsbt,
  finalizePsbt,
  broadcastTransactionDisambiguated,
  estimateFeeWithDustChange,
  validateBitcoinAddress,
} from '@/lib/bitcoin';
import type { FeeRates, UTXO } from '@/lib/bitcoin';
import { selectUtxos, type HdUtxo } from '@/lib/hdWallet';
import { extractTxFromSignedPsbtV2 } from '@/lib/psbtV2';

export type OnchainFeeSpeed = 'fastest' | 'halfHour' | 'hour' | 'economy';

/**
 * Resolves the fee rate for a given speed preset from a FeeRates bundle.
 */
function feeRateForSpeed(rates: FeeRates, speed: OnchainFeeSpeed): number {
  switch (speed) {
    case 'fastest': return rates.fastestFee;
    case 'halfHour': return rates.halfHourFee;
    case 'hour': return rates.hourFee;
    case 'economy': return rates.economyFee;
  }
}

interface OnchainZapArgs {
  /** Amount to zap in satoshis. */
  amountSats: number;
  /** Optional comment to include in the kind 8333 event content. */
  comment?: string;
  /** Fee speed preset. Defaults to "halfHour". */
  feeSpeed?: OnchainFeeSpeed;
}

interface OnchainZapResult {
  /** The broadcast Bitcoin transaction ID. */
  txid: string;
  /** Amount sent in satoshis. */
  amountSats: number;
  /** Fee paid in satoshis. */
  fee: number;
  /** The published kind 8333 event, when one was published (omitted for
   *  silent-payment sends, which intentionally publish no Nostr event). */
  event?: NostrEvent;
  /** Payment rail used, so the success handler can tell an intentional
   *  silent-payment omission from a failed receipt publish. */
  mode: 'onchain' | 'sp';
  /** Whether the user had zap-receipt publishing enabled, so the success
   *  handler can tell an intentional omission (receipts disabled in the
   *  user's publish preferences) from a failed receipt publish. */
  zapsEnabled: boolean;
}

/**
 * Recipient override for a NIP-A3 Bitcoin payment target. When present, the
 * transaction pays this address/code instead of the recipient's derived
 * Taproot address.
 *
 * - `mode: 'onchain'` — a `bc1q…`/`bc1p…` address. A kind 8333 attribution
 *   event is still published (the payment is publicly traceable, like the
 *   derived-address default).
 * - `mode: 'sp'` — a BIP-352 `sp1…` silent-payment code. No kind 8333 event
 *   is published, preserving the unlinkability silent payments provide.
 */
export interface BitcoinRecipientOverride {
  value: string;
  mode: 'onchain' | 'sp';
}

/**
 * Hook for sending on-chain (Bitcoin L1) zaps to a Nostr event or profile.
 *
 * Flow:
 *   1. Build, sign, and broadcast a Bitcoin transaction paying the target
 *      author's derived Taproot address.
 *   2. Publish a kind 8333 "onchain zap" event referencing the txid, the
 *      target event (`e` or `a` tag), and the recipient's pubkey.
 *
 * Unlike NIP-57 Lightning zaps, this works for *any* Nostr user — there is
 * no LNURL dependency because every pubkey has a derived Taproot address.
 */
export function useOnchainZap(
  target: NostrEvent,
  onSuccess?: (result: OnchainZapResult) => void,
  recipientOverride?: BitcoinRecipientOverride,
) {
  const { user } = useCurrentUser();
  const { canSignPsbt, signPsbt } = useBitcoinSigner();
  const { hd: hdWallet } = useBitcoinWallet();
  const isHd = hdWallet?.accountNode != null;
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { isEnabled } = usePublishPreferences();
  const zapsEnabled = isEnabled('zaps');
  const { toast } = useToast();
  const { config } = useAppContext();
  const { esploraApis } = config;
  const queryClient = useQueryClient();

  const [isZapping, setIsZapping] = useState(false);
  const [progress, setProgress] = useState<'idle' | 'building' | 'signing' | 'broadcasting' | 'publishing'>('idle');

  const mutation = useMutation<OnchainZapResult, Error, OnchainZapArgs>({
    mutationFn: async ({ amountSats, comment = '', feeSpeed = 'halfHour' }) => {
      if (!user) throw new Error('You must be logged in to zap.');
      if (user.pubkey === target.pubkey) throw new Error("You can't zap yourself.");
      if (!canSignPsbt || !signPsbt) {
        throw new Error(
          "Your login doesn't support sending Bitcoin. Log in with your secret key to send Bitcoin zaps.",
        );
      }
      if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error('Invalid amount.');
      }
      if (!verifyEvent(target)) {
        throw new Error('Payment target event failed signature verification.');
      }
      // Resolve the recipient. A NIP-A3 Bitcoin payment target (if present)
      // overrides the derived Taproot address. A silent-payment (`sp1…`)
      // override switches the send onto the BIP-375 SP rail and suppresses
      // the kind 8333 attribution event.
      const useSilentPayment = recipientOverride?.mode === 'sp';

      setIsZapping(true);
      setProgress('building');
      const recipientAddress =
        recipientOverride?.value ?? nostrPubkeyToBitcoinAddress(target.pubkey);

      const senderAddress = nostrPubkeyToBitcoinAddress(user.pubkey);
      if (!senderAddress || !recipientAddress) {
        throw new Error('Failed to derive Bitcoin address.');
      }
      // Re-validate on-chain addresses (derived or override). SP codes have no
      // client-side checksum we verify here — the SP PSBT builder fails on a
      // malformed code.
      if (!useSilentPayment && !validateBitcoinAddress(recipientAddress)) {
        throw new Error('Recipient Bitcoin address failed validation.');
      }

      // Fetch UTXOs and fee rates. For nsec logins use the HD wallet's scanned
      // UTXOs; otherwise fall back to the legacy single-address UTXO set.
      let hdUtxos: HdUtxo[] = [];
      let legacyUtxos: UTXO[] = [];
      let rates: FeeRates;
      if (isHd) {
        hdUtxos = hdWallet.utxos;
        rates = await getFeeRates(esploraApis);
      } else {
        [legacyUtxos, rates] = await Promise.all([
          fetchUTXOs(senderAddress, esploraApis),
          getFeeRates(esploraApis),
        ]);
      }
      const utxos = isHd ? hdUtxos : legacyUtxos;

      if (utxos.length === 0) {
        throw new Error('Your Bitcoin wallet has no spendable funds.');
      }

      const feeRate = feeRateForSpeed(rates, feeSpeed);
      const totalBalance = utxos.reduce((s, u) => s + u.value, 0);

      if (useSilentPayment && isHd) {
        const spUtxos = hdWallet.legacyUtxos;
        const spBalance = spUtxos.reduce((s, u) => s + u.value, 0);
        if (spUtxos.length === 0) {
          throw new Error('Silent Payments currently require funds at your legacy address. Use an on-chain send instead.');
        }
        const { fee: estFee } = estimateFeeWithDustChange(spUtxos.length, 1, feeRate, spBalance, amountSats);
        if (amountSats + estFee > spBalance) {
          throw new Error(
            `Insufficient legacy funds. Need ~${(amountSats + estFee).toLocaleString()} sats, have ${spBalance.toLocaleString()}.`,
          );
        }
      } else if (isHd) {
        const estFee = selectUtxos(hdUtxos, amountSats, feeRate, 1).fee;
        if (amountSats + estFee > totalBalance) {
          throw new Error(
            `Insufficient funds. Need ~${(amountSats + estFee).toLocaleString()} sats, have ${totalBalance.toLocaleString()}.`,
          );
        }
      } else {
        const { fee: estFee } = estimateFeeWithDustChange(utxos.length, 1, feeRate, totalBalance, amountSats);
        if (amountSats + estFee > totalBalance) {
          throw new Error(
            `Insufficient funds. Need ~${(amountSats + estFee).toLocaleString()} sats, have ${totalBalance.toLocaleString()}.`,
          );
        }
      }

      // Build unsigned PSBT (on-chain or silent-payment rail)
      let psbtHex: string;
      let fee: number;
      if (useSilentPayment) {
        const spUtxos = isHd ? hdWallet.legacyUtxos : (utxos as UTXO[]);
        if (isHd && spUtxos.length === 0) {
          throw new Error('Silent Payments currently require funds at your legacy address. Use an on-chain send instead.');
        }
        ({ psbtHex, fee } = buildUnsignedSilentPaymentPsbt(
          user.pubkey,
          recipientAddress,
          amountSats,
          spUtxos as UTXO[],
          feeRate,
        ));
      } else if (isHd && hdWallet.accountNode && hdWallet.changeAddress) {
        const { selected } = selectUtxos(hdUtxos, amountSats, feeRate, 1);
        ({ psbtHex, fee } = buildUnsignedPsbtHd(
          hdWallet.accountNode,
          [{ address: recipientAddress, amountSats }],
          selected,
          hdWallet.changeAddress,
          feeRate,
        ));
      } else {
        ({ psbtHex, fee } = buildUnsignedPsbt(
          user.pubkey,
          recipientAddress,
          amountSats,
          legacyUtxos,
          feeRate,
        ));
      }

      // Sign
      setProgress('signing');
      const changeAddress = useSilentPayment
        ? senderAddress
        : isHd && hdWallet.changeAddress
          ? hdWallet.changeAddress.address
          : senderAddress;
      const signedHex = await signPsbt(psbtHex, {
        paymentIntents: [{ address: recipientAddress, amountSats }],
        changeAddresses: [changeAddress],
      });
      const txHex = useSilentPayment
        ? extractTxFromSignedPsbtV2(signedHex)
        : finalizePsbt(signedHex);

      // Broadcast
      setProgress('broadcasting');
      // Disambiguated: a failed POST may still have reached a node —
      // never surface that as a retry-safe failure (double-pay risk).
      const txid = await broadcastTransactionDisambiguated(txHex, esploraApis);

      // Silent-payment sends publish no Nostr event — doing so would defeat
      // the unlinkability the rail provides.
      if (useSilentPayment) {
        return { txid, amountSats, fee, mode: 'sp', zapsEnabled };
      }

      // Publish kind 8333 event when zap receipts are enabled. When disabled
      // the omission is intentional — the success handler only warns about a
      // missing receipt when publishing was enabled and still failed.
      let event: NostrEvent | undefined;
      if (zapsEnabled) {
        setProgress('publishing');
        const isAddressable = target.kind >= 30000 && target.kind < 40000;

        const tags: string[][] = [
          ['i', `bitcoin:tx:${txid}`],
          ['p', target.pubkey],
          ['amount', String(amountSats)],
        ];

        if (isAddressable) {
          const dTag = target.tags.find(([n]) => n === 'd')?.[1] ?? '';
          tags.push(['a', `${target.kind}:${target.pubkey}:${dTag}`]);
        }

        // Always include `e` for a concrete event reference (even for addressable events)
        tags.push(['e', target.id]);

        tags.push(['alt', `Bitcoin zap: ${amountSats.toLocaleString()} sats`]);

        try {
          event = await publishEvent({
            kind: 8333,
            content: comment,
            tags,
          });
        } catch (err) {
          // The Bitcoin transaction already broadcast — the kind 8333 is a
          // best-effort attestation. Surface the failure but don't roll back
          // the success state.
          console.warn('Failed to publish kind 8333 zap event:', err);
        }
      }

      return { txid, amountSats, fee, event, mode: 'onchain', zapsEnabled };
    },
    onSuccess: (result) => {
      notificationSuccess();
      // Invalidate caches that track zaps / balances
      queryClient.invalidateQueries({ queryKey: ['onchain-zaps'] });
      queryClient.invalidateQueries({ queryKey: ['event-interactions'] });
      queryClient.invalidateQueries({ queryKey: ['bitcoin-utxos'] });
      queryClient.invalidateQueries({ queryKey: ['hd-wallet-scan'] });
      queryClient.invalidateQueries({ queryKey: ['bitcoin-balance'] });
      queryClient.invalidateQueries({ queryKey: ['bitcoin-txs'] });
      // If the caller opted into handling success themselves (e.g. the
      // ZapDialog shows a grand confirmation screen and owns the dismiss),
      // skip the built-in toast — the screen is the feedback.
      if (onSuccess) {
        onSuccess(result);
      } else {
        toast({
          title: 'Bitcoin zap sent!',
          description: `Broadcast txid ${result.txid.slice(0, 12)}… (fee ${result.fee.toLocaleString()} sats)`,
        });
      }
      // A missing receipt is only an error when the user had zap-receipt
      // publishing enabled — when they disabled it in their publish
      // preferences the omission is intentional, matching the campaign flow.
      if (result.mode === 'onchain' && result.zapsEnabled && !result.event) {
        toast({
          title: 'Zap receipt not published',
          description: 'Bitcoin was sent, but the Nostr zap receipt could not be published.',
          variant: 'destructive',
        });
      }
    },
    onError: (err) => {
      // If the signer turned out to not support PSBT signing (common for
      // NIP-46 bunkers where capability can't be probed up front), mark the
      // signer as unsupported for the rest of the session. The dialog UI
      // watches this state and replaces itself with an "unsupported" panel
      // instead of relying on this toast.
      if (isSignerCapabilityError(err) && user) {
        reportSignerUnsupported(user.pubkey);
        return;
      }
      toast({
        title: 'Bitcoin zap failed',
        description: err.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setIsZapping(false);
      setProgress('idle');
    },
  });

  return {
    zap: mutation.mutate,
    zapAsync: mutation.mutateAsync,
    // Use `mutation.isPending` so the UI disables the instant the mutation is
    // invoked, before the async `mutationFn` has had a chance to set the
    // local `isZapping` state. This closes a small double-submit window.
    isZapping: mutation.isPending || isZapping,
    progress,
    canZap: !!user && user.pubkey !== target.pubkey && canSignPsbt,
    /** Whether the logged-in user has a PSBT-capable signer. */
    canSignPsbt,
  };
}
