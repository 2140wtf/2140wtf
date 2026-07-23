import { useEffect, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useGammaOrderActions } from '@/hooks/useGammaOrderActions';
import { useGammaPayment } from '@/hooks/useGammaPayment';
import { useToast } from '@/hooks/useToast';
import { formatSats } from '@/lib/bitcoin';
import type { GammaPaymentRequest } from '@/lib/gammaMarkets';

interface PayOrderDialogProps {
  paymentRequest: GammaPaymentRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function proofLabel(kind: ReturnType<typeof import('@/hooks/useGammaPayment').detectGammaPaymentKind>): string {
  switch (kind) {
    case 'bolt11':
      return 'Payment preimage';
    case 'bolt12':
      return 'Quote id or preimage';
    case 'bitcoin':
      return 'Transaction ID';
    case 'ecash':
      return 'Cashu token or reference';
    default:
      return 'Payment reference';
  }
}

/**
 * Buyer-facing dialog to pay a Gamma Markets kind-16 type-2 payment request.
 *
 * Supports automated payment for BOLT11/BOLT12 via NWC/WebLN/Cashu, and
 * manual proof entry for Bitcoin/ecash/generic options.
 */
export function PayOrderDialog({
  paymentRequest,
  open,
  onOpenChange,
}: PayOrderDialogProps) {
  const { pay, canPay, detectKind } = useGammaPayment();
  const { sendReceipt, isPending: isSendingReceipt } = useGammaOrderActions();
  const { toast } = useToast();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [paying, setPaying] = useState(false);
  const [manualProof, setManualProof] = useState('');
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const options = paymentRequest.paymentOptions;
  const selected = options[selectedIndex];
  const kind = selected ? detectKind(selected) : 'unknown';
  const isAutomated = kind === 'bolt11' || kind === 'bolt12';
  const automatedAvailable = selected ? canPay(selected) : false;

  useEffect(() => {
    if (open) {
      setSelectedIndex(0);
      setManualProof('');
      setQrUrl(null);
    }
  }, [open, paymentRequest.eventId]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    QRCode.toDataURL(selected.value, { width: 240, margin: 2 })
      .then((url) => {
        if (alive) setQrUrl(url);
      })
      .catch(() => {
        if (alive) setQrUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [selected]);

  const handlePay = async () => {
    if (!selected) return;
    setPaying(true);
    try {
      const result = await pay(selected, paymentRequest.amountSats);
      if (result.success && result.proof) {
        await sendReceipt({
          orderId: paymentRequest.orderId,
          merchantPubkey: paymentRequest.merchantPubkey,
          amountSats: paymentRequest.amountSats,
          payments: [
            {
              medium: selected.medium,
              reference: selected.value,
              proof: result.proof,
            },
          ],
        });
        toast({ title: 'Payment sent', description: 'Receipt delivered to the seller.' });
        onOpenChange(false);
      }
    } catch (error) {
      toast({
        title: 'Payment failed',
        description: error instanceof Error ? error.message : 'Could not complete payment',
        variant: 'destructive',
      });
    } finally {
      setPaying(false);
    }
  };

  const handleManualReceipt = async () => {
    if (!selected || !manualProof.trim()) return;
    try {
      await sendReceipt({
        orderId: paymentRequest.orderId,
        merchantPubkey: paymentRequest.merchantPubkey,
        amountSats: paymentRequest.amountSats,
        payments: [
          {
            medium: selected.medium,
            reference: selected.value,
            proof: manualProof.trim(),
          },
        ],
      });
      toast({ title: 'Receipt sent', description: 'The seller has been notified.' });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Receipt failed',
        description: error instanceof Error ? error.message : 'Could not send receipt',
        variant: 'destructive',
      });
    }
  };

  const copyValue = () => {
    navigator.clipboard.writeText(selected?.value ?? '');
    toast({ title: 'Copied to clipboard' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pay order</DialogTitle>
          <DialogDescription>
            Order {paymentRequest.orderId} · {formatSats(paymentRequest.amountSats)} sats
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {options.length > 1 ? (
            <RadioGroup
              value={String(selectedIndex)}
              onValueChange={(value) => setSelectedIndex(Number(value))}
              className="space-y-2"
            >
              {options.map((option, index) => (
                <div key={`${option.medium}-${index}`} className="flex items-center space-x-2 rounded-lg border p-3">
                  <RadioGroupItem value={String(index)} id={`option-${index}`} />
                  <Label htmlFor={`option-${index}`} className="flex-1 cursor-pointer">
                    <span className="capitalize font-medium">{option.medium}</span>
                    <span className="block text-xs text-muted-foreground truncate">{option.value}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          ) : selected ? (
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium capitalize">{selected.medium}</p>
              <p className="text-xs text-muted-foreground break-all">{selected.value}</p>
            </div>
          ) : null}

          {selected && (
            <div className="flex flex-col items-center gap-3">
              {qrUrl ? (
                <img src={qrUrl} alt="Payment QR" className="rounded-lg border" />
              ) : (
                <div className="h-60 w-60 rounded-lg border bg-muted flex items-center justify-center text-muted-foreground text-sm">
                  Generating QR…
                </div>
              )}
              <Button type="button" variant="outline" size="sm" onClick={copyValue}>
                <Copy className="size-4 mr-1.5" />
                Copy {selected.medium} request
              </Button>
            </div>
          )}

          {isAutomated ? (
            <div className="space-y-2">
              <Button
                className="w-full"
                disabled={!automatedAvailable || paying || isSendingReceipt}
                onClick={() => void handlePay()}
              >
                {paying || isSendingReceipt ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <Check className="size-4 mr-2" />
                )}
                Pay {formatSats(paymentRequest.amountSats)} sats
              </Button>
              {!automatedAvailable && (
                <p className="text-xs text-muted-foreground text-center">
                  No automated wallet available. Connect NWC/WebLN or load Cashu to pay this option automatically.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="manual-proof">{proofLabel(kind)}</Label>
              <Input
                id="manual-proof"
                value={manualProof}
                onChange={(e) => setManualProof(e.target.value)}
                placeholder={`Paste your ${proofLabel(kind).toLowerCase()} here`}
              />
              <Button
                className="w-full"
                disabled={!manualProof.trim() || isSendingReceipt}
                onClick={() => void handleManualReceipt()}
              >
                {isSendingReceipt ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Send receipt
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
