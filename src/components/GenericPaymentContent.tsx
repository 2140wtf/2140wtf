import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ZapAmountInput } from '@/components/ZapAmountInput';
import { useToast } from '@/hooks/useToast';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { openUrl } from '@/lib/downloadFile';
import { type PaymentMethodDef, type PaymentTarget } from '@/lib/paymentTargets';
import { normalizeMintUrl } from '@/lib/cashu/cashu';

interface GenericPaymentContentProps {
  method: PaymentMethodDef;
  target: PaymentTarget;
  /** Current satoshi amount (controlled by the parent dialog). */
  amountSats: number | string;
  /** User currency preference. */
  currencyDisplay: 'usd' | 'sats';
  /** BTC/USD price for fiat display. */
  btcPrice?: number;
  /** Called when the amount changes. */
  onAmountChange: (value: number | string) => void;
  /** Called when a native Cashu BOLT12 payment succeeds. */
  onSuccess?: (result: { amountSats: number }) => void;
}

/**
 * Renders a non-native payment method (Monero, Ethereum, Nano, Cash App, …) in
 * the zap dialog: a QR code of the preferred URI, a copyable address, and a
 * clickable button that opens the native URI (e.g. `monero:<addr>`) where one
 * exists. We never generate `payto:` URIs — the native scheme is preferred and
 * custodial handles fall back to their web payment page.
 *
 * For BOLT12 offers we additionally offer a Cashu settlement path when the
 * buyer has a funded Cashu wallet (NUT-25 / BOLT12 melt via the mint).
 */
export function GenericPaymentContent({
  method,
  target,
  amountSats,
  currencyDisplay,
  btcPrice,
  onAmountChange,
  onSuccess,
}: GenericPaymentContentProps) {
  const { toast } = useToast();
  const cashuWallet = useCashuWalletContext();
  const [copied, setCopied] = useState(false);
  const [paying, setPaying] = useState(false);

  const uri = useMemo(() => method.uri(target.authority), [method, target.authority]);
  // QR encodes the native URI when there is one (so wallet apps can scan it),
  // otherwise the bare address/handle.
  const qrValue = uri ?? target.authority;

  // Truncate long addresses (e.g. Monero) the same way the wallet page does;
  // short handles (Cash App, etc.) are shown in full.
  const displayAddress = useMemo(() => {
    const addr = target.authority;
    return addr.length > 24 ? `${addr.slice(0, 12)}...${addr.slice(-8)}` : addr;
  }, [target.authority]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(target.authority);
      setCopied(true);
      toast({ title: 'Copied', description: `${method.label} address copied to clipboard` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Copy failed', description: 'Please copy manually.', variant: 'destructive' });
    }
  };

  const isBolt12 = method.type === 'bolt12';
  const canPayWithCashu = isBolt12 && cashuWallet.seedAvailable;

  const numericSats = useMemo(() => {
    const value = typeof amountSats === 'string' ? Number(amountSats.replace(/,/g, '')) : amountSats;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [amountSats]);

  const currentMintBalance = useMemo(() => {
    const normalized = normalizeMintUrl(cashuWallet.mintUrl);
    return normalized !== null ? (cashuWallet.balances[normalized] ?? 0) : 0;
  }, [cashuWallet.mintUrl, cashuWallet.balances]);

  const handleCashuPay = async () => {
    if (!canPayWithCashu || numericSats <= 0) return;
    if (currentMintBalance < numericSats) {
      toast({
        title: 'Insufficient Cashu balance',
        description: `Need ${numericSats} sats on the selected mint.`,
        variant: 'destructive',
      });
      return;
    }
    setPaying(true);
    try {
      const result = await cashuWallet.payBolt12(target.authority, numericSats);
      if (result.success) {
        toast({ title: 'BOLT12 payment sent', description: `${result.amount} sats paid via Cashu.` });
        onSuccess?.({ amountSats: result.amount });
      } else {
        toast({
          title: 'BOLT12 payment failed',
          description: cashuWallet.error || 'The mint could not pay the offer.',
          variant: 'destructive',
        });
      }
    } catch (e) {
      toast({
        title: 'BOLT12 payment failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="grid gap-3 px-4 py-4 w-full overflow-hidden">
      {isBolt12 && (
        <Alert variant="default" className="bg-muted/50 text-xs">
          <AlertDescription>
            BOLT12 offers are static Lightning addresses. Scan the QR, copy the offer, or pay directly
            with your Cashu wallet if the mint supports BOLT12.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex justify-center">
        <div className="bg-white p-3 rounded-xl" aria-label={`${method.label} payment QR code`}>
          <QRCodeCanvas value={qrValue} size={220} level="M" className="block" />
        </div>
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={handleCopy}
          title={target.authority}
          aria-label={`Copy ${method.label} address`}
          className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-mono text-muted-foreground hover:bg-muted/50 transition-colors cursor-pointer max-w-full"
        >
          <span className="truncate">{displayAddress}</span>
          {copied ? (
            <Check className="size-3.5 shrink-0 text-green-500" />
          ) : (
            <Copy className="size-3.5 shrink-0" />
          )}
        </button>
      </div>

      {uri && (
        <Button type="button" onClick={() => openUrl(uri)} className="w-full">
          <ExternalLink className="h-4 w-4 mr-2" />
          Open in {method.label}
        </Button>
      )}

      {canPayWithCashu && (
        <div className="border-t pt-3 mt-1 space-y-3">
          <div className="text-sm font-medium text-center">Or pay with Cashu</div>
          <ZapAmountInput
            amountSats={amountSats}
            onChange={onAmountChange}
            btcPrice={btcPrice}
            currencyDisplay={currencyDisplay}
          />
          <Button
            type="button"
            onClick={handleCashuPay}
            disabled={paying || numericSats <= 0 || currentMintBalance < numericSats}
            className="w-full"
          >
            {paying ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Paying…
              </>
            ) : (
              `Pay ${numericSats > 0 ? numericSats.toLocaleString() : ''} sats with Cashu`
            )}
          </Button>
          {currentMintBalance < numericSats && numericSats > 0 && (
            <p className="text-xs text-destructive text-center">
              Insufficient balance on the selected Cashu mint.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
