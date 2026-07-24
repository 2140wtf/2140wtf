import { useState, useEffect, useRef, useMemo, useCallback, forwardRef } from 'react';
import { Copy, Check, ExternalLink, X, Loader2, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { openUrl } from '@/lib/downloadFile';
import { impactMedium } from '@/lib/haptics';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { OnchainZapContent } from '@/components/OnchainZapContent';
import { GenericPaymentContent } from '@/components/GenericPaymentContent';
import { CashuZapContent } from '@/components/CashuZapContent';
import { PaymentMethodIcon } from '@/components/PaymentMethodIcon';
import { ZapAmountInput } from '@/components/ZapAmountInput';
import { ZapSuccessScreen } from '@/components/ZapSuccessScreen';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { useZaps } from '@/hooks/useZaps';
import { useWallet } from '@/hooks/useWallet';
import { useAppContext } from '@/hooks/useAppContext';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { usePaymentTargets } from '@/hooks/usePaymentTargets';
import { useZapPaymentListener } from '@/hooks/useZapPaymentListener';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';

import { canZap } from '@/lib/canZap';
import { parseCampaign } from '@/lib/campaign';
import {
  PAYMENT_METHODS,
  findBitcoinTarget,
  findLightningTarget,
  isSilentPaymentLike,
  type PaymentMethodKind,
  type PaymentTarget,
} from '@/lib/paymentTargets';
import type { BitcoinRecipientOverride } from '@/hooks/useOnchainZap';
import {
  fetchBtcPrice,
  isLargeAmount,
} from '@/lib/bitcoin';
import type { Event } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import type { WebLNProvider } from '@webbtc/webln-types';

interface ZapDialogProps {
  target: Event;
  /**
   * Optional trigger node. When provided, the dialog wraps it in a
   * `DialogTrigger` so a click opens the dialog (uncontrolled use).
   * Omit when controlling the dialog's `open` state from the outside.
   */
  children?: React.ReactNode;
  className?: string;
  /**
   * Controlled open state. When set, the dialog ignores its internal
   * trigger-click handling and follows this prop instead. Pair with
   * `onOpenChange`.
   */
  open?: boolean;
  /** Controlled open setter. Required when `open` is provided. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional NIP-69 poll option index. When set, the zap is cast as a vote
   * on a kind 6969 zap poll and the dialog restricts payment to Lightning.
   */
  pollOption?: string;
  /**
   * Optional callback invoked when a Lightning zap succeeds. This is called
   * in addition to the dialog's internal success state handling.
   */
  onZapSuccess?: (result: { amountSats: number }) => void;
  /**
   * Optional satoshi amount to prefill the amount field with. When omitted
   * the dialog starts at the user's configured default zap amount
   * (`config.defaultZapAmount`, 1,000 sats unless changed in wallet settings).
   */
  initialAmountSats?: number;
  /**
   * Optional list of payment method ids that should be offered. When omitted,
   * all discovered payment rails are shown. Used by NIP-99 listings that declare
   * accepted methods via `payment` tags.
   */
  allowedPaymentMethods?: string[];
}

// Sats presets for the Lightning tab. Lightning zaps are expected to be
// much smaller than on-chain sends (which have a fixed per-tx fee floor),
// so the presets stay in tip-jar territory.
const LIGHTNING_SATS_PRESETS = [100, 500, 1000, 5000, 10000];

/**
 * Identifier for a selectable payment method in the dialog. Native methods use
 * fixed ids; generic payment targets reuse their NIP-A3 type string.
 */
type DialogMethodId = string;

/** A method shown in the dialog's title switcher. */
interface DialogMethod {
  id: DialogMethodId;
  /** Display label, e.g. "Bitcoin", "Cashu". */
  label: string;
  /** Drives rendering and icon selection. */
  kind: PaymentMethodKind;
  /** Optional override icon (rare; PaymentMethodIcon handles the common rails). */
  icon?: React.ReactNode;
  /** The underlying payment target, for generic (non-native) methods. */
  target?: PaymentTarget;
}

interface LightningZapContentProps {
  invoice: string | null;
  amountSats: number | string;
  currencyDisplay: 'usd' | 'sats';
  btcPrice: number | undefined;
  isZapping: boolean;
  copied: boolean;
  webln: WebLNProvider | null;
  insufficient: boolean;
  isLarge: boolean;
  confirmArmed: boolean;
  error: string;
  handleZap: () => void;
  handleCopy: () => void;
  openInWallet: () => void;
  setAmountSats: (amount: number | string) => void;
  setError: (msg: string) => void;
  editingAmount: boolean;
  setEditingAmount: (v: boolean) => void;
  amountInputRef: React.RefObject<HTMLInputElement | null>;
  payWithWebLN: () => void;
}

/**
 * Lightning zap flow. Mirrors the onchain tab: one screen, one button, no
 * comment field. Amount is denominated in satoshis; the display follows the
 * user's currency preference and shows the alternate denomination in the
 * corner.
 *
 * Defined outside `ZapDialog` as a `forwardRef` to keep the amount input
 * from losing focus on parent re-renders.
 */
const LightningZapContent = forwardRef<HTMLDivElement, LightningZapContentProps>(({
  invoice,
  amountSats,
  currencyDisplay,
  btcPrice,
  isZapping,
  copied,
  webln,
  isLarge,
  confirmArmed,
  error,
  handleZap,
  handleCopy,
  openInWallet,
  setAmountSats,
  setError,
  editingAmount,
  setEditingAmount,
  amountInputRef,
  payWithWebLN,
}, ref) => {
  const numericSats = typeof amountSats === 'string'
    ? (amountSats.trim() === '' ? 0 : Number(amountSats.replace(/,/g, '')))
    : amountSats;
  const { format: formatMoney } = useFormatMoney();
  const primaryDisplay = formatMoney(numericSats);

  if (invoice) {
    return (
      <div ref={ref} className="grid gap-3 px-4 py-4 w-full overflow-hidden">
        {/* Amount header */}
        <div className="flex flex-col items-center pt-1">
          <div className="text-3xl font-semibold tabular-nums">
            {primaryDisplay}
          </div>
        </div>

        {/* QR code */}
        <div className="flex justify-center">
          <div className="bg-white p-3 rounded-xl" aria-label="Lightning invoice QR code">
            <QRCodeCanvas value={invoice.toUpperCase()} size={220} level="M" className="block" />
          </div>
        </div>

        {/* Invoice copy row */}
        <div className="flex gap-2 min-w-0">
          <Input
            id="invoice"
            value={invoice}
            readOnly
            aria-label="Lightning invoice"
            className="font-mono text-xs min-w-0 flex-1 overflow-hidden text-ellipsis"
            onClick={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleCopy}
            className="shrink-0"
            aria-label="Copy invoice"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Payment actions */}
        <div className="grid gap-2">
          {webln && (
            <Button
              type="button"
              onClick={payWithWebLN}
              disabled={isZapping}
              className="w-full"
            >
              {isZapping ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                  Processing…
                </>
              ) : (
                'Pay with WebLN'
              )}
            </Button>
          )}
          <Button
            type="button"
            variant={webln ? 'outline' : 'default'}
            onClick={openInWallet}
            className="w-full"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open in Lightning Wallet
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground text-center">
          Scan the QR or copy the invoice to pay with any Lightning wallet.
        </p>
      </div>
    );
  }

  return (
    <div ref={ref} className="grid gap-3 px-4 py-4 w-full overflow-hidden">
      <ZapAmountInput
        amountSats={amountSats}
        onChange={(value) => { setAmountSats(value); setError(''); }}
        btcPrice={btcPrice}
        currencyDisplay={currencyDisplay}
        presets={LIGHTNING_SATS_PRESETS}
        disabled={isZapping}
        inputRef={amountInputRef}
        editing={editingAmount}
        onEditingChange={setEditingAmount}
      />

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <Button
        type="button"
        onClick={handleZap}
        disabled={numericSats <= 0 || isZapping}
        variant={isLarge && !isZapping ? 'destructive' : 'default'}
        className="w-full"
      >
        {isZapping ? (
          <>
            <Loader2 className="size-4 mr-1.5 animate-spin" />
            Creating invoice…
          </>
        ) : isLarge && confirmArmed ? (
          <>Tap again to send {primaryDisplay}</>
        ) : (
          <>Send {primaryDisplay}</>
        )}
      </Button>
    </div>
  );
});
LightningZapContent.displayName = 'LightningZapContent';

export function ZapDialog({
  target,
  children,
  className,
  open: controlledOpen,
  onOpenChange,
  pollOption,
  onZapSuccess: onZapSuccessProp,
  initialAmountSats,
  allowedPaymentMethods,
}: ZapDialogProps) {
  // Parse kind 33863 campaigns so this dialog can route donations to the
  // campaign's declared `w` endpoint instead of the author's derived
  // Taproot address. Falsy when the target is not a campaign (or is a
  // malformed one — let the regular flow handle it).
  const campaign = useMemo(
    () => (target.kind === 33863 ? parseCampaign(target as NostrEvent) : null),
    [target],
  );

  // NIP-69 zap poll vote context.
  const isPollVote = pollOption !== undefined;
  const pollValueMinimum = useMemo(() => {
    if (!isPollVote) return undefined;
    const tag = target.tags.find(([name]) => name === 'value_minimum');
    if (!tag?.[1]) return undefined;
    const n = parseInt(tag[1], 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [isPollVote, target]);
  const pollValueMaximum = useMemo(() => {
    if (!isPollVote) return undefined;
    const tag = target.tags.find(([name]) => name === 'value_maximum');
    if (!tag?.[1]) return undefined;
    const n = parseInt(tag[1], 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [isPollVote, target]);

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  // Allow the caller to control open state from the outside (used by ZapMenu
  // to open the dialog after its parent popover finishes dismissing).
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setUncontrolledOpen(next);
      }
    },
    [isControlled, onOpenChange],
  );
  const { user } = useCurrentUser();
  const { data: author } = useAuthor(target.pubkey);
  const { toast } = useToast();
  const { webln, activeNWC } = useWallet();
  const { config } = useAppContext();
  const { esploraApis } = config;

  const primaryRelay = useMemo(() => {
    if (!isPollVote) return undefined;
    return target.tags.find(([name]) => name === 'p')?.[2] || config.relayMetadata.relays[0]?.url;
  }, [isPollVote, target, config]);

  // NIP-A3 payment targets declared by the recipient. We don't fetch these
  // for campaigns (campaigns route through their own `w` endpoint). Only
  // fetch once the dialog is open — otherwise every ZapDialog rendered behind
  // a feed's zap button would fire a kind 10133 REQ on mount while closed.
  const { targets: paymentTargets } = usePaymentTargets(
    campaign || !open ? undefined : target.pubkey,
  );

  // A Lightning payment target is preferred over the kind-0 lud16 when zapping.
  const lightningTarget = useMemo(() => findLightningTarget(paymentTargets), [paymentTargets]);

  // Success state: populated by either zap rail's onSuccess callback.
  // When set, we replace the method UI with <ZapSuccessScreen />.
  const [success, setSuccess] = useState<
    | { kind: 'onchain'; amountSats: number; txid: string }
    | { kind: 'lightning'; amountSats: number }
    | { kind: 'cashu'; amountSats: number; eventId?: string }
    | { kind: 'bolt12'; amountSats: number }
    | null
  >(null);

  const handleLightningSuccess = useCallback(
    ({ amountSats }: { amountSats: number }) => {
      setSuccess({ kind: 'lightning', amountSats });
      onZapSuccessProp?.({ amountSats });
    },
    [onZapSuccessProp],
  );

  const { zap, isZapping, invoice, setInvoice } = useZaps(
    target,
    webln,
    activeNWC,
    handleLightningSuccess,
    lightningTarget?.authority,
    pollOption,
    primaryRelay,
  );

  const currencyDisplay = config.currencyDisplay ?? 'sats';

  // Sats-denominated state (matches OnchainZapContent). The display follows
  // the user's currency preference and shows the alternate value in the corner.
  const [amountSats, setAmountSats] = useState<number | string>(initialAmountSats ?? config.defaultZapAmount);
  const [copied, setCopied] = useState(false);
  const [editingAmount, setEditingAmount] = useState(false);
  const [error, setError] = useState('');
  const [confirmArmed, setConfirmArmed] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const { data: btcPrice } = useQuery({
    queryKey: ['btc-price', esploraApis],
    queryFn: ({ signal }) => fetchBtcPrice(esploraApis, signal),
    staleTime: 30_000,
  });

  const numericAmountSats = useMemo(() => {
    const value = typeof amountSats === 'string' ? Number(amountSats.replace(/,/g, '')) : amountSats;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [amountSats]);

  const isLarge = isLargeAmount(numericAmountSats, btcPrice);
  // Lightning has no local balance concept (the wallet / LNURL handles that),
  // so `insufficient` stays false — kept for symmetry with the onchain props.
  const insufficient = false;

  // Listen for a kind 9735 zap receipt on the QR-code path (WebLN/NWC already
  // report success through handleLightningSuccess).
  const relayUrls = useMemo(
    () => config.relayMetadata.relays.filter((r) => r.read).map((r) => r.url),
    [config.relayMetadata.relays],
  );
  useZapPaymentListener(
    invoice,
    target,
    relayUrls,
    useCallback(() => {
      if (success) return;
      setSuccess({ kind: 'lightning', amountSats: numericAmountSats });
      onZapSuccessProp?.({ amountSats: numericAmountSats });
    }, [success, numericAmountSats, onZapSuccessProp]),
  );

  // Default method: Bitcoin. Users can switch to Lightning or any configured
  // payment target via the title dropdown. If the user's signer can't sign
  // PSBTs AND Lightning is available, we transparently default to Lightning
  // instead of showing an unusable Bitcoin method as the primary option.
  const hasLightning = canZap(author?.metadata);

  // A Bitcoin payment target overrides the recipient's derived Taproot
  // address. An `sp1…` code routes onto the silent-payment rail (no kind
  // 8333); a `bc1…` address keeps the standard on-chain attribution.
  const bitcoinTarget = useMemo(() => findBitcoinTarget(paymentTargets), [paymentTargets]);
  const bitcoinOverride: BitcoinRecipientOverride | undefined = useMemo(() => {
    if (!bitcoinTarget) return undefined;
    return {
      value: bitcoinTarget.authority,
      mode: isSilentPaymentLike(bitcoinTarget.authority) ? 'sp' : 'onchain',
    };
  }, [bitcoinTarget]);
  const bitcoinIsSilentPayment = useMemo(
    () => !!bitcoinTarget && isSilentPaymentLike(bitcoinTarget.authority),
    [bitcoinTarget],
  );

  // Cashu / NIP-61 Nutzap capability. The recipient must publish a kind 10019
  // event with accepted mints; the sender needs an initialized Cashu wallet.
  const cashuWallet = useCashuWalletContext();
  const hasCashu = !campaign && !isPollVote && cashuWallet.seedAvailable;

  // Generic (non-native) payment targets — Monero, Ethereum, etc. These render
  // a QR + native-URI button rather than a built-in send flow.
  const genericTargets = useMemo(
    () =>
      paymentTargets.filter(
        (t) => t.type !== 'bitcoin' && t.type !== 'lightning',
      ),
    [paymentTargets],
  );

  // Build the ordered list of selectable methods for this dialog.
  // Campaigns always render the single on-chain pane (no method switcher).
  // NIP-69 zap poll votes are Lightning-only.
  //
  // For profile zaps we no longer derive a Bitcoin address from the recipient's
  // npub. On-chain Bitcoin is only offered when the recipient has explicitly
  // published a NIP-A3 `payto bitcoin` target (a `bc1…` address or, preferably,
  // a BIP-352 `sp1…` silent-payment code).
  //
  // Cashu is not a NIP-A3 target; it is discovered via the recipient's NIP-61
  // kind 10019 event and rendered as a native rail when both sides support it.
  const methods = useMemo<DialogMethod[]>(() => {
    if (campaign) return [];
    if (isPollVote) {
      return (hasLightning || lightningTarget)
        ? [{ id: 'lightning', label: 'Lightning', kind: 'lightning' }]
        : [];
    }
    const list: DialogMethod[] = [];
    if (bitcoinTarget) {
      list.push(
        bitcoinIsSilentPayment
          ? { id: 'silent-payments', label: 'Silent Payments', kind: 'bitcoin' }
          : { id: 'bitcoin', label: 'Bitcoin', kind: 'bitcoin' },
      );
    }
    if (hasLightning || lightningTarget) {
      list.push({ id: 'lightning', label: 'Lightning', kind: 'lightning' });
    }
    if (hasCashu) {
      list.push({ id: 'cashu', label: 'Cashu', kind: 'cashu' });
    }
    for (const t of genericTargets) {
      const def = PAYMENT_METHODS[t.type];
      list.push({ id: t.type, label: def.label, kind: def.kind, target: t });
    }

    if (allowedPaymentMethods && allowedPaymentMethods.length > 0) {
      const allowed = new Set(allowedPaymentMethods.map((m) => m.toLowerCase()));
      return list.filter((m) => {
        if (m.id === 'cashu') return allowed.has('cashu');
        if (m.id === 'bitcoin') return allowed.has('bitcoin');
        if (m.id === 'silent-payments') return allowed.has('silent-payments');
        if (m.id === 'lightning') return allowed.has('lightning');
        if (m.target) {
          if (m.id === 'monero') return allowed.has('monero') || allowed.has('xmr');
          return allowed.has(m.id);
        }
        return true;
      });
    }

    return list;
  }, [campaign, bitcoinIsSilentPayment, bitcoinTarget, hasLightning, lightningTarget, hasCashu, genericTargets, isPollVote, allowedPaymentMethods]);

  const defaultMethodId: DialogMethodId = useMemo(() => {
    if (isPollVote) return 'lightning';
    if (hasLightning || lightningTarget) return 'lightning';
    if (bitcoinTarget) return bitcoinIsSilentPayment ? 'silent-payments' : 'bitcoin';
    if (hasCashu) return 'cashu';
    return methods[0]?.id ?? 'bitcoin';
  }, [bitcoinIsSilentPayment, bitcoinTarget, hasLightning, lightningTarget, hasCashu, isPollVote, methods]);
  const [activeMethod, setActiveMethod] = useState<DialogMethodId>(defaultMethodId);

  const currentMethod =
    methods.find((m) => m.id === activeMethod) ?? methods[0];

  // Re-arm (clear confirmation) whenever the amount moves — editing after
  // arming forces another deliberate click. Mirrors OnchainZapContent.
  useEffect(() => {
    setConfirmArmed(false);
  }, [numericAmountSats]);

  // Focus + select-all when the amount is clicked into edit mode.
  useEffect(() => {
    if (editingAmount) {
      amountInputRef.current?.focus();
      amountInputRef.current?.select();
    }
  }, [editingAmount]);

  const handleCopy = async () => {
    if (invoice) {
      await navigator.clipboard.writeText(invoice);
      setCopied(true);
      toast({
        title: 'Invoice copied',
        description: 'Lightning invoice copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openInWallet = () => {
    if (invoice) {
      openUrl(`lightning:${invoice}`);
    }
  };

  useEffect(() => {
    if (open) {
      setAmountSats(initialAmountSats ?? config.defaultZapAmount);
      setInvoice(null);
      setCopied(false);
      setEditingAmount(false);
      setError('');
      setConfirmArmed(false);
      setSuccess(null);
      setActiveMethod(defaultMethodId);
    } else {
      setAmountSats(initialAmountSats ?? config.defaultZapAmount);
      setInvoice(null);
      setCopied(false);
      setEditingAmount(false);
      setError('');
      setConfirmArmed(false);
      setSuccess(null);
    }
    // `defaultMethodId` deliberately excluded — we only want to reset the
    // active method on open/close, not on every capability re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, setInvoice, initialAmountSats]);

  // Previously, if Bitcoin capability flipped to `unsupported` mid-session we
  // auto-switched to Lightning because the Bitcoin pane was a dead-end. The
  // Bitcoin pane now shows a QR fallback for unsupported signers, so users
  // should be free to switch into it. We only bias the *initial* method choice
  // toward Lightning (above, in the useState initializer and the open-reset
  // effect); manual navigation into Bitcoin is respected.

  const handleZap = () => {
    setError('');
    if (numericAmountSats <= 0) { setError('Enter an amount.'); return; }

    // Enforce NIP-69 zap poll value limits (tags are in satoshis).
    if (isPollVote) {
      if (pollValueMinimum !== undefined && numericAmountSats < pollValueMinimum) {
        setError(`Minimum vote is ${pollValueMinimum.toLocaleString()} sats.`);
        return;
      }
      if (pollValueMaximum !== undefined && numericAmountSats > pollValueMaximum) {
        setError(`Maximum vote is ${pollValueMaximum.toLocaleString()} sats.`);
        return;
      }
    }

    // Two-tap safety for large amounts: first click arms, second click sends.
    if (isLarge && !confirmArmed) {
      setConfirmArmed(true);
      return;
    }

    impactMedium();
    zap(numericAmountSats, '');
  };

  const payWithWebLN = () => {
    if (!btcPrice) { setError('Waiting for BTC price…'); return; }
    if (numericAmountSats <= 0) { setError('Enter an amount.'); return; }

    // Enforce NIP-69 zap poll value limits for WebLN payments too.
    if (isPollVote) {
      if (pollValueMinimum !== undefined && numericAmountSats < pollValueMinimum) {
        setError(`Minimum vote is ${pollValueMinimum.toLocaleString()} sats.`);
        return;
      }
      if (pollValueMaximum !== undefined && numericAmountSats > pollValueMaximum) {
        setError(`Maximum vote is ${pollValueMaximum.toLocaleString()} sats.`);
        return;
      }
    }

    zap(numericAmountSats, '');
  };

  const lightningContentProps: LightningZapContentProps = {
    invoice,
    amountSats,
    currencyDisplay,
    btcPrice,
    isZapping,
    copied,
    webln,
    insufficient,
    isLarge,
    confirmArmed,
    error,
    handleZap,
    handleCopy,
    openInWallet,
    setAmountSats,
    setError,
    editingAmount,
    setEditingAmount,
    amountInputRef,
    payWithWebLN,
  };

  // Zap button shows for any logged-in user except when targeting oneself.
  // Campaigns bypass the self-check: a creator donating to their own
  // campaign is legitimate. NIP-69 poll authors cannot vote on their own polls.
  //
  // For non-campaign profile zaps, require at least one usable payment method:
  // a declared bitcoin target, Lightning capability/target, Cashu/Nutzap, or a
  // generic NIP-A3 payment method. No method = nothing to zap with.
  const canOpenZap = !!user && (!!campaign || user.pubkey !== target.pubkey) &&
    (!isPollVote || user.pubkey !== target.pubkey) &&
    (campaign || methods.length > 0);

  // Event context passed to Cashu Nutzaps. Profile zaps (kind 0 target) are
  // identity-only and should not tag a specific event.
  const cashuZappedEvent = useMemo(
    () =>
      target.kind === 0
        ? undefined
        : { id: target.id, kind: target.kind, relay: relayUrls[0] },
    [target, relayUrls],
  );

  if (!canOpenZap) {
    // Uncontrolled callers wrap a trigger node; render it bare so the icon
    // still appears (just won't open anything). Controlled callers don't
    // pass children and won't try to open the dialog for themselves anyway.
    return children ? <>{children}</> : null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && (
        <DialogTrigger asChild>
          <div className={`cursor-pointer ${className || ''}`} onClick={(e) => e.stopPropagation()}>
            {children}
          </div>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-[425px] rounded-2xl p-0 gap-0 border-border overflow-hidden max-h-[95vh] [&>button]:hidden" data-testid="zap-modal">
        <div className="flex items-center justify-between px-4 h-12">
          <DialogTitle className="text-base font-semibold flex items-center gap-1.5 min-w-0">
            {success ? (
              'Success'
            ) : isPollVote ? (
              'Vote on poll'
            ) : campaign ? (
              `Donate to ${campaign.title}`
            ) : invoice ? (
              <>
                Lightning Payment{' '}
                <HelpTip faqId="send-bitcoin-lightning" />
              </>
            ) : methods.length > 1 ? (
              // More than one payment method available (Lightning and/or
              // declared NIP-A3 payment targets) → the title becomes a method
              // switcher. The current method's icon + label + a down chevron
              // open a dropdown of all available methods.
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 min-w-0 rounded-md px-1 -mx-1 hover:bg-secondary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    aria-label="Switch payment method"
                  >
                    <PaymentMethodIcon method={currentMethod ? { kind: currentMethod.kind, symbol: currentMethod.target ? PAYMENT_METHODS[currentMethod.target.type].symbol : undefined } : undefined} />
                    <span className="truncate">{methodTitle(currentMethod)}</span>
                    <ChevronDown className="size-4 shrink-0 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-44" onClick={(e) => e.stopPropagation()}>
                  {methods.map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      onSelect={() => setActiveMethod(m.id)}
                      className="gap-2"
                    >
                      <PaymentMethodIcon method={m.target ? { kind: m.kind, symbol: PAYMENT_METHODS[m.target.type].symbol } : { kind: m.kind }} />
                      <span>{m.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                Send Bitcoin{' '}
                <HelpTip faqId="send-bitcoin-onchain" />
              </>
            )}
          </DialogTitle>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 -mr-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto">
          {success ? (
            <ZapSuccessScreen
              recipientPubkey={target.pubkey}
              recipientLabel={campaign?.title}
              amountSats={success.amountSats}
              btcPrice={btcPrice}
              txid={success.kind === 'onchain' ? success.txid : undefined}
              eventId={success.kind === 'cashu' ? success.eventId : undefined}
              kind={success.kind}
              onClose={() => setOpen(false)}
            />
          ) : campaign ? (
            // Campaign donations (kind 33863) use the single-pane on-chain UI,
            // routing the send through the campaign's `w` endpoint.
            <OnchainZapContent
              target={target}
              campaign={campaign}
              onSuccess={({ txid, amountSats }) =>
                setSuccess({ kind: 'onchain', amountSats, txid })
              }
              onClose={() => setOpen(false)}
            />
          ) : (
            <ZapMethodPane
              method={currentMethod}
              target={target}
              bitcoinOverride={bitcoinOverride}
              lightningContentProps={lightningContentProps}
              onOnchainSuccess={({ txid, amountSats }) =>
                setSuccess({ kind: 'onchain', amountSats, txid })
              }
              onCashuSuccess={({ amountSats, eventId }) =>
                setSuccess({ kind: 'cashu', amountSats, eventId })
              }
              onBolt12Success={({ amountSats }) =>
                setSuccess({ kind: 'bolt12', amountSats })
              }
              zappedEvent={cashuZappedEvent}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Title label for the current method (native Bitcoin keeps "Send Bitcoin"). */
function methodTitle(method: DialogMethod | undefined): string {
  if (!method) return 'Send Bitcoin';
  if (method.kind === 'bitcoin') {
    return method.id === 'silent-payments' ? 'Send Silent Payment' : 'Send Bitcoin';
  }
  return method.label;
}

interface ZapMethodPaneProps {
  method: DialogMethod | undefined;
  target: Event;
  bitcoinOverride: BitcoinRecipientOverride | undefined;
  lightningContentProps: LightningZapContentProps;
  onOnchainSuccess: (result: { txid: string; amountSats: number }) => void;
  onCashuSuccess: (result: { amountSats: number; eventId?: string }) => void;
  onBolt12Success: (result: { amountSats: number }) => void;
  zappedEvent?: { id: string; kind: number; relay?: string };
  onClose: () => void;
}

/** Renders the body for the currently-selected payment method. */
function ZapMethodPane({
  method,
  target,
  bitcoinOverride,
  lightningContentProps,
  onOnchainSuccess,
  onCashuSuccess,
  onBolt12Success,
  zappedEvent,
  onClose,
}: ZapMethodPaneProps) {
  if (method?.kind === 'lightning') {
    return <LightningZapContent {...lightningContentProps} />;
  }
  if (method?.kind === 'cashu') {
    return (
      <CashuZapContent
        target={target}
        amountSats={lightningContentProps.amountSats}
        currencyDisplay={lightningContentProps.currencyDisplay}
        btcPrice={lightningContentProps.btcPrice}
        onAmountChange={lightningContentProps.setAmountSats}
        onSuccess={onCashuSuccess}
        zappedEvent={zappedEvent}
      />
    );
  }
  if (method?.kind === 'generic' && method.target) {
    return (
      <GenericPaymentContent
        method={PAYMENT_METHODS[method.target.type]}
        target={method.target}
        amountSats={lightningContentProps.amountSats}
        currencyDisplay={lightningContentProps.currencyDisplay}
        btcPrice={lightningContentProps.btcPrice}
        onAmountChange={lightningContentProps.setAmountSats}
        onSuccess={onBolt12Success}
      />
    );
  }
  // Default: native Bitcoin. Profile zaps use the derived Taproot address
  // unless a Bitcoin payment target overrides it.
  return (
    <OnchainZapContent
      target={target as NostrEvent}
      bitcoinTarget={bitcoinOverride}
      onSuccess={onOnchainSuccess}
      onClose={onClose}
    />
  );
}
