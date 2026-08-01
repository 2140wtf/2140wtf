import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { verifyEvent } from 'nostr-tools';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBitcoinSigner, isSignerCapabilityError, reportSignerUnsupported } from '@/hooks/useBitcoinSigner';
import { useBitcoinWallet } from '@/hooks/useBitcoinWallet';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { usePublishPreferences } from '@/hooks/usePublishPreferences';
import { useAppContext } from '@/hooks/useAppContext';
import { notificationSuccess } from '@/lib/haptics';
import {
  buildUnsignedPsbt,
  buildUnsignedPsbtHd,
  buildUnsignedSilentPaymentPsbt,
  broadcastTransactionDisambiguated,
  estimateFeeWithDustChange,
  fetchUTXOs,
  finalizePsbt,
  getFeeRates,
  nostrPubkeyToBitcoinAddress,
  validateBitcoinAddress,
} from '@/lib/bitcoin';
import type { FeeRates, UTXO } from '@/lib/bitcoin';
import { selectUtxos, type HdUtxo } from '@/lib/hdWallet';
import { extractTxFromSignedPsbtV2 } from '@/lib/psbtV2';
import { CAMPAIGN_KIND, type ParsedCampaign } from '@/lib/campaign';

export type OnchainFeeSpeed = 'fastest' | 'halfHour' | 'hour' | 'economy';

function feeRateForSpeed(rates: FeeRates, speed: OnchainFeeSpeed): number {
  switch (speed) {
    case 'fastest': return rates.fastestFee;
    case 'halfHour': return rates.halfHourFee;
    case 'hour': return rates.hourFee;
    case 'economy': return rates.economyFee;
  }
}

interface CampaignZapArgs {
  /** Amount to donate in satoshis. */
  amountSats: number;
  /** Optional comment to include in the kind 8333 receipt's content (on-chain mode only). */
  comment?: string;
  /** Fee speed preset. Defaults to "halfHour". */
  feeSpeed?: OnchainFeeSpeed;
}

interface CampaignZapResult {
  /** The broadcast Bitcoin transaction ID. */
  txid: string;
  /** Amount sent in satoshis. */
  amountSats: number;
  /** Fee paid in satoshis. */
  fee: number;
  /** The kind 8333 receipt event, when published (on-chain only — SP donations
   *  intentionally publish no Nostr event per spec). */
  event?: NostrEvent;
  /** The rail used for the donation. */
  mode: 'onchain' | 'sp';
  /** Whether kind-8333 receipt publishing was attempted. */
  zapsEnabled: boolean;
}

/**
 * Send a Bitcoin donation to a kind 33863 Fundraiser/Campaign from 2140.wtf's
 * built-in PSBT-capable wallet.
 *
 * Pass `null` when the caller doesn't currently have a campaign in hand —
 * the hook returns no-op mutation handlers that throw if invoked. This
 * lets components conditionally route between {@link useOnchainZap} and
 * `useCampaignZap` without violating the rules of hooks.
 *
 * Rail selection:
 *
 * - If the campaign declares **both** an on-chain (`bc1…`) and a silent
 *   payment (`sp1…`) endpoint, the **on-chain** rail is preferred — it
 *   contributes to the campaign's public aggregate UI and the spec's
 *   example flow assumes on-chain when both are present.
 * - If only one endpoint is present, that one is used.
 *
 * Receipt publishing:
 *
 * - **On-chain mode** publishes a kind 8333 receipt in *campaign-wallet*
 *   form per `NIP.md` Kind 33863: `i` (txid), `amount`, `a` (campaign
 *   coordinate), `K` (`"33863"`), `alt`. **No `p` tags** — campaigns
 *   are not Nostr-identity recipients.
 * - **Silent-payment mode** publishes **no Nostr event**. Doing so would
 *   defeat the unlinkability the rail is designed to provide.
 *
 * Spec compliance: the campaign's parser already enforces mainnet
 * `bc1q…` / `bc1p…` checksums at parse time, but we re-validate the
 * on-chain endpoint here so a relay-corrupted campaign that somehow
 * reached the renderer can't quietly send to garbage. SP endpoints have
 * no client-side checksum verification (per parser); donor wallets fail
 * at output derivation if the code is malformed.
 */
export function useCampaignZap(
  campaign: ParsedCampaign | null,
  onSuccess?: (result: CampaignZapResult) => void,
) {
  const { user } = useCurrentUser();
  const { canSignPsbt, signPsbt } = useBitcoinSigner();
  const { hd: hdWallet } = useBitcoinWallet();
  const isHd = hdWallet?.accountNode != null;
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const { isEnabled } = usePublishPreferences();
  const { config } = useAppContext();
  const { esploraApis } = config;
  const queryClient = useQueryClient();

  const [isZapping, setIsZapping] = useState(false);
  const [progress, setProgress] = useState<'idle' | 'building' | 'signing' | 'broadcasting' | 'publishing'>('idle');

  const mutation = useMutation<CampaignZapResult, Error, CampaignZapArgs>({
    mutationFn: async ({ amountSats, comment = '', feeSpeed = 'halfHour' }) => {
      if (!campaign) throw new Error('No campaign to donate to.');
      if (!user) throw new Error('You must be logged in to donate.');
      if (!canSignPsbt || !signPsbt) {
        throw new Error(
          "Your login doesn't support sending Bitcoin. Log in with your secret key to donate from 2140.wtf.",
        );
      }
      if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error('Invalid amount.');
      }
      if (!verifyEvent(campaign.event)) {
        throw new Error('Campaign event failed signature verification.');
      }

      // Per the plan, prefer the on-chain rail when both are declared.
      const useOnchain = !!campaign.wallets.onchain;
      const wallet = useOnchain ? campaign.wallets.onchain! : campaign.wallets.sp!;
      if (!wallet) throw new Error('This campaign has no donatable endpoint.');

      // Re-validate the on-chain address — campaign-parser-level validation
      // already ran, but a relay round-trip or local-cache corruption could
      // have mutated bytes since. SP endpoints have no checksum we can
      // verify here; the donor wallet fails the derivation if malformed.
      if (useOnchain && !validateBitcoinAddress(wallet.value)) {
        throw new Error('Campaign wallet address failed validation.');
      }

      setIsZapping(true);
      setProgress('building');

      const senderAddress = nostrPubkeyToBitcoinAddress(user.pubkey);
      if (!senderAddress) throw new Error('Failed to derive sender Bitcoin address.');

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

      if (useOnchain) {
        if (isHd) {
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
      } else {
        // Silent-payment rail: for HD users the builder currently only
        // understands the legacy single-address key, so restrict to legacy
        // UTXOs until the builder is made HD-aware.
        const spUtxos = isHd ? hdWallet.legacyUtxos : (utxos as UTXO[]);
        const spBalance = spUtxos.reduce((s, u) => s + u.value, 0);
        if (isHd && spUtxos.length === 0) {
          throw new Error('Silent Payments currently require funds at your legacy address. Use an on-chain donation instead.');
        }
        const { fee: estFee } = estimateFeeWithDustChange(spUtxos.length, 1, feeRate, spBalance, amountSats);
        if (amountSats + estFee > spBalance) {
          throw new Error(
            `Insufficient legacy funds. Need ~${(amountSats + estFee).toLocaleString()} sats, have ${spBalance.toLocaleString()}.`,
          );
        }
      }

      // Build PSBT per rail.
      let psbtHex: string;
      let fee: number;
      if (useOnchain) {
        if (isHd && hdWallet.accountNode && hdWallet.changeAddress) {
          const { selected } = selectUtxos(hdUtxos, amountSats, feeRate, 1);
          ({ psbtHex, fee } = buildUnsignedPsbtHd(
            hdWallet.accountNode,
            [{ address: wallet.value, amountSats }],
            selected,
            hdWallet.changeAddress,
            feeRate,
          ));
        } else {
          ({ psbtHex, fee } = buildUnsignedPsbt(
            user.pubkey,
            wallet.value,
            amountSats,
            legacyUtxos,
            feeRate,
          ));
        }
      } else {
        const spUtxos = isHd ? hdWallet.legacyUtxos : (utxos as UTXO[]);
        if (isHd && spUtxos.length === 0) {
          throw new Error('Silent Payments currently require funds at your legacy address. Use an on-chain donation instead.');
        }
        ({ psbtHex, fee } = buildUnsignedSilentPaymentPsbt(
          user.pubkey,
          wallet.value,
          amountSats,
          spUtxos as UTXO[],
          feeRate,
        ));
      }

      setProgress('signing');
      const changeAddress = useOnchain
        ? isHd && hdWallet.changeAddress
          ? hdWallet.changeAddress.address
          : senderAddress
        : senderAddress;
      const signedHex = await signPsbt(psbtHex, {
        paymentIntents: [{ address: wallet.value, amountSats }],
        changeAddresses: [changeAddress],
      });

      // BIP-375 signers return a finalized PSBT v2 for SP sends; the legacy
      // signer path returns a PSBT v0 we hand to `finalizePsbt`.
      const txHex = useOnchain ? finalizePsbt(signedHex) : extractTxFromSignedPsbtV2(signedHex);

      setProgress('broadcasting');
      // Disambiguated: a failed POST may still have reached a node —
      // never surface that as a retry-safe failure (double-pay risk).
      const txid = await broadcastTransactionDisambiguated(txHex, esploraApis);

      // Publish a kind 8333 receipt for on-chain donations only.
      let event: NostrEvent | undefined;
      const zapsEnabled = useOnchain ? isEnabled('zaps') : false;
      if (useOnchain && zapsEnabled) {
        setProgress('publishing');
        const aTag = `${CAMPAIGN_KIND}:${campaign.pubkey}:${campaign.identifier}`;
        try {
          event = await publishEvent({
            kind: 8333,
            content: comment,
            tags: [
              ['i', `bitcoin:tx:${txid}`],
              ['amount', String(amountSats)],
              ['a', aTag],
              ['K', String(CAMPAIGN_KIND)],
              ['alt', `Donation to ${campaign.title}: ${amountSats.toLocaleString()} sats`],
            ],
          });
        } catch (err) {
          // The Bitcoin transaction already broadcast — the kind 8333 is a
          // best-effort attestation. Surface the failure in the console but
          // don't roll back: the donation stands on-chain regardless.
          console.warn('Failed to publish kind 8333 campaign receipt:', err);
        }
      }

      return { txid, amountSats, fee, event, mode: useOnchain ? 'onchain' : 'sp', zapsEnabled };
    },
    onSuccess: (result) => {
      notificationSuccess();
      queryClient.invalidateQueries({ queryKey: ['onchain-zaps'] });
      queryClient.invalidateQueries({ queryKey: ['bitcoin-utxos'] });
      queryClient.invalidateQueries({ queryKey: ['hd-wallet-scan'] });
      queryClient.invalidateQueries({ queryKey: ['bitcoin-balance'] });
      queryClient.invalidateQueries({ queryKey: ['bitcoin-txs'] });
      if (campaign) {
        queryClient.invalidateQueries({
          queryKey: ['campaign-donations', `${CAMPAIGN_KIND}:${campaign.pubkey}:${campaign.identifier}`],
        });
      }
      if (onSuccess) {
        onSuccess(result);
      } else {
        toast({
          title: 'Donation sent!',
          description: `Broadcast txid ${result.txid.slice(0, 12)}… (fee ${result.fee.toLocaleString()} sats)`,
        });
      }
      if (result.mode === 'onchain' && result.zapsEnabled && !result.event) {
        toast({
          title: 'Donation receipt not published',
          description: 'Bitcoin was sent, but the Nostr donation receipt could not be published.',
          variant: 'destructive',
        });
      }
    },
    onError: (err) => {
      if (isSignerCapabilityError(err) && user) {
        reportSignerUnsupported(user.pubkey);
        return;
      }
      toast({
        title: 'Donation failed',
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
    /** Whether the current user can donate from the in-app wallet. */
    canZap: !!user && !!campaign && canSignPsbt,
    /** Whether the logged-in user has a PSBT-capable signer. */
    canSignPsbt,
  };
}
