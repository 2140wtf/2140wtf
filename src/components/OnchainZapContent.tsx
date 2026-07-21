import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, Bitcoin, Copy, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ZapAmountInput } from '@/components/ZapAmountInput';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBitcoinSigner } from '@/hooks/useBitcoinSigner';
import { useOnchainZap, type OnchainFeeSpeed } from '@/hooks/useOnchainZap';
import { useCampaignZap } from '@/hooks/useCampaignZap';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useNostrLogin } from '@nostrify/react/login';
import { useHdWallet } from '@/hooks/useHdWallet';
import {
  nostrPubkeyToBitcoinAddress,
  fetchUTXOs,
  fetchBtcPrice,
  getFeeRates,
  estimateFee,
  isLargeAmount,
  formatSats,
  looksLikeSilentPaymentAddress,
} from '@/lib/bitcoin';
import { selectUtxos } from '@/lib/hdWallet';
import type { NostrEvent } from '@nostrify/nostrify';
import type { ParsedCampaign } from '@/lib/campaign';
import type { BitcoinRecipientOverride } from '@/hooks/useOnchainZap';

/** Bitcoin dust limit in satoshis. Outputs below this are dropped by relay policy. */
const DUST_LIMIT_SATS = 546;

const FEE_SPEED_LABELS: Record<OnchainFeeSpeed, string> = {
  fastest: '~10 min',
  halfHour: '~30 min',
  hour: '~1 hour',
  economy: '~1 day',
};

const FEE_SPEED_ORDER: OnchainFeeSpeed[] = ['fastest', 'halfHour', 'hour', 'economy'];

const ONCHAIN_SATS_PRESETS = [1_000, 5_000, 10_000, 25_000, 100_000];

/**
 * Given the raw mempool fee rates (sat/vB), return a deduplicated list of
 * speed tiers. When multiple tiers share the same rate (common when the
 * mempool is empty and everything collapses to 1 sat/vB), we keep only the
 * fastest-labeled tier for that rate. This prevents rows like "~10 min 2
 * sat/vB / ~30 min 2 sat/vB / ~1 hour 2 sat/vB" in the UI.
 */
function getRateForSpeed(rates: { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number }, speed: OnchainFeeSpeed): number {
  switch (speed) {
    case 'fastest': return rates.fastestFee;
    case 'halfHour': return rates.halfHourFee;
    case 'hour': return rates.hourFee;
    case 'economy': return rates.economyFee;
  }
}

function getUniqueFeeSpeeds(
  rates: { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number } | undefined,
): OnchainFeeSpeed[] {
  if (!rates) return FEE_SPEED_ORDER;
  const seen = new Set<number>();
  const result: OnchainFeeSpeed[] = [];
  for (const speed of FEE_SPEED_ORDER) {
    const rate = getRateForSpeed(rates, speed);
    if (!seen.has(rate)) {
      seen.add(rate);
      result.push(speed);
    }
  }
  return result;
}

interface OnchainZapContentProps {
  target: NostrEvent;
  /**
   * Optional campaign override. When set, the zap flow sends to the
   * campaign's declared `w` endpoint (on-chain or silent-payment) via
   * {@link useCampaignZap} and publishes a campaign-mode kind 8333
   * receipt (or no receipt at all, for SP-only campaigns). The self-zap
   * guard is bypassed — a campaign creator donating to their own
   * campaign is legitimate.
   *
   * Callers MUST gate this prop on `canSignPsbt === true` — the
   * unsupported-signer QR fallback inside this component is keyed to a
   * Nostr-identity derived address and isn't wired for campaigns. When
   * the user lacks a PSBT signer, the parent dialog should hide the
   * zap UI entirely and rely on its own QR / Open-native-wallet path.
   */
  campaign?: ParsedCampaign;
  /**
   * Optional NIP-A3 Bitcoin payment-target override. When set, the zap pays
   * this address/code instead of the recipient's derived Taproot address.
   * A `bc1…` override still publishes a kind 8333 attribution; an `sp1…`
   * override routes onto the silent-payment rail and publishes no event.
   */
  bitcoinTarget?: BitcoinRecipientOverride;
  /** Called with the tx result when a zap successfully broadcasts. */
  onSuccess?: (result: { txid: string; amountSats: number }) => void;
  /** Called when the user dismisses without a send (e.g. "Done" in the
   * unsupported-signer QR fallback). */
  onClose?: () => void;
}

/**
 * Bitcoin zap flow. Publishes a BTC transaction paying the target author's
 * derived Taproot address, then publishes a kind 8333 event linking the tx
 * to the target event.
 *
 * UX mirrors the Lightning zap flow: one screen, one button, no review step.
 * Balance, fee breakdown, and confirmation are all hidden unless needed.
 */
export function OnchainZapContent({ target, campaign, bitcoinTarget, onSuccess, onClose }: OnchainZapContentProps) {
  const { user } = useCurrentUser();
  const { capability, canAttemptPsbt } = useBitcoinSigner();
  const { logins } = useNostrLogin();
  const { config } = useAppContext();
  const { esploraApis } = config;
  const loginType = logins[0]?.type;
  const { format: formatMoney } = useFormatMoney();
  const currencyDisplay = config.currencyDisplay ?? 'sats';

  const [amountSats, setAmountSats] = useState<number | string>(5_000);
  const [feeSpeed, setFeeSpeed] = useState<OnchainFeeSpeed>('halfHour');
  const [error, setError] = useState('');
  const [feePopoverOpen, setFeePopoverOpen] = useState(false);
  const feeSpeedUserChanged = useRef(false);

  // Tracks whether the user has manually picked a fee speed. Once true, we
  // stop auto-adjusting the fee in response to amount changes.

  const senderAddress = user ? nostrPubkeyToBitcoinAddress(user.pubkey) : '';
  const hd = useHdWallet();
  const isHd = hd.isHd;

  // Recipient address used for the unsupported-signer QR fallback and for
  // the post-zap details row. Campaigns prefer the on-chain endpoint (the
  // SP path can't be QR-fallback'd here — donor wallets must derive the
  // output script themselves), falling back to the SP code if that's all
  // the campaign declared.
  const recipientAddress = useMemo(() => {
    if (campaign) {
      return campaign.wallets.onchain?.value ?? campaign.wallets.sp?.value ?? '';
    }
    // Profile zaps no longer derive a Bitcoin address from the recipient's
    // npub. On-chain zaps are only sent when the recipient has explicitly
    // published a NIP-A3 `payto bitcoin` target (ideally a BIP-352 `sp1…`
    // silent-payment code, but a `bc1…` address is also accepted).
    return bitcoinTarget?.value ?? '';
  }, [campaign, bitcoinTarget]);
  const isSilentPayment = useMemo(
    () => looksLikeSilentPaymentAddress(recipientAddress),
    [recipientAddress],
  );
  const truncatedRecipient = recipientAddress
    ? `${recipientAddress.slice(0, 10)}…${recipientAddress.slice(-8)}`
    : '';

  const { data: btcPrice } = useQuery({
    queryKey: ['btc-price', esploraApis],
    queryFn: ({ signal }) => fetchBtcPrice(esploraApis, signal),
    staleTime: 30_000,
  });

  // For nsec logins use the HD wallet's scanned UTXOs; otherwise fall back to
  // the legacy single-address UTXO set.
  const legacyUtxosQuery = useQuery({
    queryKey: ['bitcoin-utxos', esploraApis, senderAddress],
    queryFn: ({ signal }) => fetchUTXOs(senderAddress, esploraApis, signal),
    enabled: !!senderAddress && canAttemptPsbt && !isHd,
    staleTime: 30_000,
  });

  const hdUtxos = useMemo(() => hd.utxos ?? [], [hd.utxos]);
  const hdLegacyUtxos = useMemo(() => hd.legacyUtxos ?? [], [hd.legacyUtxos]);
  const legacyUtxos = useMemo(() => legacyUtxosQuery.data ?? [], [legacyUtxosQuery.data]);
  // Silent payments spend the legacy single-address UTXO set even for HD users.
  const spendUtxos = isHd ? (isSilentPayment ? hdLegacyUtxos : hdUtxos) : legacyUtxos;

  const { data: feeRates } = useQuery({
    queryKey: ['bitcoin-fee-rates', esploraApis],
    queryFn: ({ signal }) => getFeeRates(esploraApis, signal),
    enabled: canAttemptPsbt,
    staleTime: 30_000,
  });

  const totalBalance = useMemo(() => spendUtxos?.reduce((s, u) => s + u.value, 0) ?? 0, [spendUtxos]);

  const currentFeeRate = useMemo(() => {
    if (!feeRates) return 0;
    return getRateForSpeed(feeRates, feeSpeed);
  }, [feeRates, feeSpeed]);

  const numericAmountSats = useMemo(() => {
    const value = typeof amountSats === 'string' ? Number(amountSats.replace(/,/g, '')) : amountSats;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [amountSats]);

  const estimatedFeeSats = useMemo(() => {
    if (!spendUtxos?.length || !currentFeeRate || !numericAmountSats) return 0;
    if (isHd) {
      const hdSpendUtxos = isSilentPayment ? hdLegacyUtxos : hdUtxos;
      try {
        return selectUtxos(hdSpendUtxos, numericAmountSats, currentFeeRate, 1).fee;
      } catch {
        return 0;
      }
    }
    const fee2 = estimateFee(spendUtxos.length, 2, currentFeeRate);
    const change = totalBalance - numericAmountSats - fee2;
    const numOutputs = change >= DUST_LIMIT_SATS ? 2 : 1;
    return estimateFee(spendUtxos.length, numOutputs, currentFeeRate);
  }, [spendUtxos, currentFeeRate, numericAmountSats, totalBalance, isHd, hdUtxos, hdLegacyUtxos, isSilentPayment]);

  const totalSats = numericAmountSats + estimatedFeeSats;
  const insufficient = totalBalance > 0 && totalSats > totalBalance;
  const showBalance = insufficient || (numericAmountSats > 0 && totalBalance === 0);

  // Warn when the transaction will have no change output because the leftover
  // is below the dust limit. In that case the leftover sats become extra fee
  // rather than returning as change.
  const noChangeDust = useMemo(() => {
    if (!spendUtxos?.length || !currentFeeRate || numericAmountSats <= 0 || totalBalance <= 0) return false;
    if (isHd) {
      const hdSpendUtxos = isSilentPayment ? hdLegacyUtxos : hdUtxos;
      try {
        const change = selectUtxos(hdSpendUtxos, numericAmountSats, currentFeeRate, 1).change;
        return change > 0 && change <= DUST_LIMIT_SATS;
      } catch {
        return false;
      }
    }
    const feeWithChange = estimateFee(spendUtxos.length, 2, currentFeeRate);
    const change = totalBalance - numericAmountSats - feeWithChange;
    return change > 0 && change <= DUST_LIMIT_SATS;
  }, [spendUtxos, currentFeeRate, numericAmountSats, totalBalance, isHd, hdUtxos, hdLegacyUtxos, isSilentPayment]);

  // Auto-adjust fee speed when the amount changes, unless the user has
  // already picked a speed manually. Aim for a fee below 40% of the amount
  // by stepping down through the unique speed tiers. If every tier still
  // blows past 40% (tiny amount), fall back to the cheapest tier so we at
  // least minimize the hit.
  useEffect(() => {
    if (feeSpeedUserChanged.current) return;
    if (!spendUtxos?.length || !feeRates || numericAmountSats <= 0) return;

    const uniqueSpeeds = getUniqueFeeSpeeds(feeRates);
    const threshold = numericAmountSats * 0.4;

    let target: OnchainFeeSpeed = uniqueSpeeds[uniqueSpeeds.length - 1];
    for (const speed of uniqueSpeeds) {
      const rate = getRateForSpeed(feeRates, speed);
      let fee: number;
      if (isHd) {
        const hdSpendUtxos = isSilentPayment ? hdLegacyUtxos : hdUtxos;
        try {
          fee = selectUtxos(hdSpendUtxos, numericAmountSats, rate, 1).fee;
        } catch {
          continue;
        }
      } else {
        const fee2 = estimateFee(spendUtxos.length, 2, rate);
        const change = totalBalance - numericAmountSats - fee2;
        const outputs = change >= DUST_LIMIT_SATS ? 2 : 1;
        fee = estimateFee(spendUtxos.length, outputs, rate);
      }
      if (fee <= threshold) {
        target = speed;
        break;
      }
    }

    setFeeSpeed((prev) => (prev === target ? prev : target));
  }, [numericAmountSats, feeRates, spendUtxos, totalBalance, isHd, hdUtxos, hdLegacyUtxos, isSilentPayment]);

  const handleFeeSpeedChange = useCallback((speed: OnchainFeeSpeed) => {
    feeSpeedUserChanged.current = true;
    setFeeSpeed(speed);
    setFeePopoverOpen(false);
  }, []);

  // For large amounts, require a two-tap confirmation on the primary button.
  // This catches fat-finger sends without nagging on normal amounts.
  const isLarge = isLargeAmount(totalSats, btcPrice);
  const [confirmArmed, setConfirmArmed] = useState(false);

  // Re-arm (i.e. clear confirmation) whenever the amount, fee rate, or price
  // moves — so editing after arming forces another deliberate click.
  useEffect(() => {
    setConfirmArmed(false);
  }, [numericAmountSats, currentFeeRate, btcPrice]);

  // Always call both hooks (rules of hooks) — pass `null` to the
  // campaign hook when not in campaign mode so its mutation throws if
  // somehow invoked. We then route through the active one based on
  // whether `campaign` is set.
  const profileZap = useOnchainZap(target, (result) => {
    onSuccess?.({ txid: result.txid, amountSats: result.amountSats });
  }, bitcoinTarget);
  const campaignZap = useCampaignZap(campaign ?? null, (result) => {
    onSuccess?.({ txid: result.txid, amountSats: result.amountSats });
  });
  const { zapAsync, isZapping, progress } = campaign ? campaignZap : profileZap;

  const handleZap = useCallback(async () => {
    setError('');
    if (!user) { setError('You must be logged in.'); return; }
    // Self-zap guard applies only to profile zaps. Campaign creators
    // donating to their own campaign is legitimate (and harmless on
    // chain — they're moving their own funds to their own address).
    if (!campaign && user.pubkey === target.pubkey) {
      setError("You can't zap yourself.");
      return;
    }
    // `capability === 'unsupported'` is already handled by the UI replacement
    // above; 'supported' and 'unknown' both proceed (the latter may fail at
    // sign time, which will then flip the UI to the unsupported state).
    if (!btcPrice) { setError('Waiting for BTC price…'); return; }
    if (numericAmountSats <= 0) { setError('Enter an amount.'); return; }
    if (!spendUtxos?.length) { setError("You don't have any Bitcoin yet. Receive some first."); return; }
    if (insufficient) { setError('Not enough Bitcoin for this amount + network fee.'); return; }

    // Two-tap safety for large amounts: first click arms, second click sends.
    if (isLarge && !confirmArmed) {
      setConfirmArmed(true);
      return;
    }

    try {
      await zapAsync({ amountSats: numericAmountSats, comment: '', feeSpeed });
      // onSuccess (passed to useOnchainZap) closes the dialog; toast is shown by the hook.
    } catch (err) {
      // Capability errors flip the UI via `reportSignerUnsupported` in the
      // hook's `onError`; no need to surface a form-level error for those.
      const msg = err instanceof Error ? err.message : 'Zap failed';
      const isCapability = /does not support|doesn't support|signpsbt|sign_psbt/i.test(msg);
      if (!isCapability) setError(msg);
    }
  }, [user, target.pubkey, campaign, btcPrice, numericAmountSats, spendUtxos, insufficient, zapAsync, feeSpeed, isLarge, confirmArmed]);

  // ── Signer not supported ──────────────────────────────────────
  // The user's signer can't sign PSBTs locally (extension without signPsbt,
  // or a bunker that rejected sign_psbt). Instead of a dead-end, show a QR
  // they can scan with any external Bitcoin wallet. We can't observe the
  // resulting txid, so we don't publish a kind 8333 — the user is warned
  // that the zap won't be attributed to them on Nostr.

  const uniqueFeeSpeeds = useMemo(() => getUniqueFeeSpeeds(feeRates), [feeRates]);

  if (user && capability === 'unsupported') {
    return (
      <UnsupportedSignerQR
        recipientAddress={recipientAddress}
        truncatedRecipient={truncatedRecipient}
        isSilentPayment={looksLikeSilentPaymentAddress(recipientAddress)}
        amountSats={amountSats}
        btcPrice={btcPrice}
        currencyDisplay={currencyDisplay}
        setAmountSats={setAmountSats}
        loginType={loginType}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="grid gap-4 px-4 py-4 w-full overflow-hidden">
      <ZapAmountInput
        amountSats={amountSats}
        onChange={(value) => { setAmountSats(value); setError(''); }}
        btcPrice={btcPrice}
        currencyDisplay={currencyDisplay}
        presets={ONCHAIN_SATS_PRESETS}
        disabled={isZapping}
      />

      {/* Error */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* No-change dust warning: leftover below the dust limit will be
          swallowed by the fee instead of returning as change. */}
      {noChangeDust && (
        <Alert className="border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
          <AlertTriangle className="size-4" />
          <AlertDescription className="text-xs">
            This zap leaves less than the dust limit, so there will be no change
            output. The remaining sats will be added to the network fee.
          </AlertDescription>
        </Alert>
      )}

      <Button
        onClick={handleZap}
        disabled={!btcPrice || numericAmountSats <= 0 || isZapping || insufficient}
        variant={(insufficient || isLarge) && !isZapping ? 'destructive' : 'default'}
        className="w-full"
      >
        {isZapping ? (
          <>
            <Loader2 className="size-4 mr-1.5 animate-spin" />
            {progressLabel(progress)}
          </>
        ) : insufficient ? (
          <>Not enough Bitcoin</>
        ) : isLarge && confirmArmed ? (
          <>Tap again to send {formatMoney(totalSats)}</>
        ) : (
          <>Send {formatMoney(totalSats)}</>
        )}
      </Button>

      {/* Fee line — click to open speed picker */}
      {numericAmountSats > 0 && (
        <div className="flex items-center justify-center gap-3 -mt-1 text-xs">
          <Popover open={feePopoverOpen} onOpenChange={setFeePopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>
                  Fee{' '}
                  {estimatedFeeSats > 0
                    ? `≈ ${formatMoney(estimatedFeeSats)}`
                    : '…'}
                  <span className="opacity-60"> · {FEE_SPEED_LABELS[feeSpeed]}</span>
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="center" sideOffset={6} className="w-56 p-1">
              <div className="flex flex-col">
                {uniqueFeeSpeeds.map((speed) => {
                  const rate = feeRates ? getRateForSpeed(feeRates, speed) : 0;
                  const selected = speed === feeSpeed;
                  return (
                    <button
                      key={speed}
                      type="button"
                      onClick={() => handleFeeSpeedChange(speed)}
                      className={`flex items-center justify-between px-2 py-1.5 rounded-sm text-xs text-left hover:bg-muted transition-colors ${selected ? 'bg-muted font-medium' : ''}`}
                    >
                      <span>{FEE_SPEED_LABELS[speed]}</span>
                      <span className="text-muted-foreground">{rate} sat/vB</span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          {showBalance && !insufficient && (
            <span className="text-muted-foreground">
              Balance: {formatMoney(totalBalance)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function progressLabel(progress: 'idle' | 'building' | 'signing' | 'broadcasting' | 'publishing'): string {
  switch (progress) {
    case 'building': return 'Building…';
    case 'signing': return 'Signing…';
    case 'broadcasting': return 'Broadcasting…';
    case 'publishing': return 'Publishing…';
    default: return 'Processing…';
  }
}

// ──────────────────────────────────────────────────────────────
// Unsupported-signer QR fallback
// ──────────────────────────────────────────────────────────────

interface UnsupportedSignerQRProps {
  recipientAddress: string;
  truncatedRecipient: string;
  /** When true, `recipientAddress` is a BIP-352 silent-payment code. */
  isSilentPayment?: boolean;
  amountSats: number | string;
  btcPrice: number | undefined;
  currencyDisplay: 'usd' | 'sats';
  setAmountSats: (v: number | string) => void;
  loginType: string | undefined;
  onClose?: () => void;
}

/**
 * Fallback shown when the user's signer can't sign PSBTs locally. Renders a
 * BIP-21 QR the user can scan with any external Bitcoin wallet. Because we
 * never see the resulting tx, we skip publishing the kind 8333 zap event and
 * explicitly warn the user about that.
 */
function UnsupportedSignerQR({
  recipientAddress,
  truncatedRecipient,
  isSilentPayment,
  amountSats,
  btcPrice,
  currencyDisplay,
  setAmountSats,
  loginType,
  onClose,
}: UnsupportedSignerQRProps) {
  const { toast } = useToast();
  const { format: formatMoney } = useFormatMoney();
  const [copied, setCopied] = useState<'address' | 'uri' | null>(null);

  const numericSats = useMemo(() => {
    const value = typeof amountSats === 'string' ? Number(amountSats.replace(/,/g, '')) : amountSats;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [amountSats]);

  // BIP-21 URI. Include `amount` (in BTC, 8 decimals) only when > 0 so an
  // empty-amount placeholder QR doesn't include `?amount=0`. Silent-payment
  // codes go in the `sp=` parameter (the URI has no on-chain path) so
  // BIP-352-aware wallets pick them up.
  const bip21 = useMemo(() => {
    if (!recipientAddress) return '';
    const params = new URLSearchParams();
    if (numericSats > 0) {
      params.set('amount', (numericSats / 100_000_000).toFixed(8));
    }
    if (isSilentPayment) {
      params.set('sp', recipientAddress);
      const qs = params.toString();
      return qs ? `bitcoin:?${qs}` : `bitcoin:?sp=${recipientAddress}`;
    }
    const qs = params.toString();
    return qs ? `bitcoin:${recipientAddress}?${qs}` : `bitcoin:${recipientAddress}`;
  }, [recipientAddress, numericSats, isSilentPayment]);

  const explanation =
    loginType === 'extension'
      ? "Your browser extension can't sign Bitcoin transactions."
      : loginType === 'bunker'
        ? "Your remote signer can't sign Bitcoin transactions."
        : "Your signer can't sign Bitcoin transactions.";

  const copy = useCallback(
    async (value: string, which: 'address' | 'uri', label: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(which);
        toast({ title: 'Copied', description: `${label} copied to clipboard` });
        setTimeout(() => setCopied(null), 2000);
      } catch {
        toast({ title: 'Copy failed', description: 'Please copy manually.', variant: 'destructive' });
      }
    },
    [toast],
  );

  const cornerText = useMemo(() => {
    if (!btcPrice || numericSats <= 0) return null;
    if (currencyDisplay === 'usd') {
      return `${formatSats(numericSats)} sats`;
    }
    return undefined;
  }, [currencyDisplay, numericSats, btcPrice]);

  return (
    <div className="grid gap-3 px-4 py-4 w-full overflow-hidden">
      <p className="text-xs text-muted-foreground">
        {explanation} You can still zap by scanning this QR from any Bitcoin wallet.
      </p>

      <ZapAmountInput
        amountSats={amountSats}
        onChange={setAmountSats}
        btcPrice={btcPrice}
        currencyDisplay={currencyDisplay}
        presets={[1_000, 5_000, 10_000, 25_000, 100_000]}
      />

      {/* QR / placeholder */}
      <div className="flex justify-center">
        {numericSats > 0 && bip21 ? (
          <div className="bg-white p-3 rounded-xl" aria-label="Bitcoin payment QR code">
            <QRCodeCanvas value={bip21} size={220} level="M" className="block" />
          </div>
        ) : (
          <div className="size-[220px] rounded-xl border border-dashed flex items-center justify-center text-xs text-muted-foreground text-center px-4">
            {btcPrice
              ? 'Choose an amount above to generate a payment QR.'
              : 'Loading BTC price…'}
          </div>
        )}
      </div>

      {/* Amount summary */}
      {numericSats > 0 && btcPrice && (
        <div className="text-center text-sm">
          <span className="font-medium">
            {formatMoney(numericSats)}
          </span>
          {cornerText && (
            <span className="text-muted-foreground">
              {' · '}{cornerText}
            </span>
          )}
        </div>
      )}

      {/* Recipient */}
      {recipientAddress && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 min-w-0">
            <Bitcoin className="size-3.5 text-orange-500 shrink-0" />
            <span className="shrink-0">To:</span>
            <span className="font-mono truncate" title={recipientAddress}>{truncatedRecipient}</span>
          </div>
        </div>
      )}

      {/* Copy buttons */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => copy(recipientAddress, 'address', 'Address')}
          disabled={!recipientAddress}
          className="text-xs"
        >
          {copied === 'address' ? <Check className="size-3.5 mr-1.5" /> : <Copy className="size-3.5 mr-1.5" />}
          Copy address
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => copy(bip21, 'uri', 'Payment link')}
          disabled={!numericSats || !bip21}
          className="text-xs"
        >
          {copied === 'uri' ? <Check className="size-3.5 mr-1.5" /> : <Copy className="size-3.5 mr-1.5" />}
          Copy link
        </Button>
      </div>

      {/* Warning: no kind 8333 will be published */}
      <Alert>
        <AlertTriangle className="size-4" />
        <AlertDescription className="text-xs">
          Because we can't see your transaction, this zap won't show up as yours on Nostr. The recipient will still get the Bitcoin.
        </AlertDescription>
      </Alert>

      {onClose && (
        <Button type="button" variant="secondary" onClick={onClose} className="w-full">
          Done
        </Button>
      )}
    </div>
  );
}
