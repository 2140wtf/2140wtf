import { useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useGammaOrderActions } from '@/hooks/useGammaOrderActions';
import { useToast } from '@/hooks/useToast';
import { formatSats } from '@/lib/bitcoin';
import { validateBitcoinAddress } from '@/lib/bitcoin';
import type { GammaOrder, GammaPaymentMedium } from '@/lib/gammaMarkets';
import { isSilentPaymentAddress, validateSilentPaymentAddress } from '@/lib/silentPayments';

interface RequestPaymentDialogProps {
  order: GammaOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DraftOption {
  id: string;
  medium: GammaPaymentMedium;
  value: string;
}

const MEDIUM_OPTIONS: { value: GammaPaymentMedium; label: string; placeholder: string }[] = [
  { value: 'lightning', label: 'Lightning', placeholder: 'lnbc1… BOLT11 invoice' },
  { value: 'bolt12', label: 'BOLT12', placeholder: 'lno1… BOLT12 offer' },
  { value: 'bitcoin', label: 'Bitcoin', placeholder: 'bc1… address or sp1… silent payment' },
  { value: 'ecash', label: 'Ecash', placeholder: 'Cashu request' },
];

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function validateOptionValue(medium: GammaPaymentMedium, value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  switch (medium) {
    case 'lightning':
      return v.toLowerCase().startsWith('ln') && !v.toLowerCase().startsWith('lno1');
    case 'bolt12':
      return v.toLowerCase().startsWith('lno1');
    case 'bitcoin':
      if (isSilentPaymentAddress(v)) return validateSilentPaymentAddress(v);
      return validateBitcoinAddress(v);
    case 'ecash':
    case 'fiat':
      return v.length > 2;
    default:
      return false;
  }
}

/**
 * Merchant-facing dialog to send a Gamma Markets kind-16 type-2 payment request.
 *
 * Prefills the order amount and lets the seller add one or more payment options
 * (Lightning invoice/BOLT12, Bitcoin address, Ecash request). An optional
 * expiration and note can be attached.
 */
export function RequestPaymentDialog({
  order,
  open,
  onOpenChange,
}: RequestPaymentDialogProps) {
  const { sendPaymentRequest, isPending } = useGammaOrderActions();
  const { toast } = useToast();

  const [amountSats, setAmountSats] = useState(order.amountSats);
  const [options, setOptions] = useState<DraftOption[]>([
    { id: generateId(), medium: 'lightning', value: '' },
  ]);
  const [expirationMinutes, setExpirationMinutes] = useState('');
  const [note, setNote] = useState('');

  const expiration = useMemo(() => {
    const minutes = Number(expirationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
    return Math.floor(Date.now() / 1000) + minutes * 60;
  }, [expirationMinutes]);

  const allValid = useMemo(
    () => Number.isFinite(amountSats) && amountSats > 0 && options.every((o) => validateOptionValue(o.medium, o.value)),
    [amountSats, options],
  );

  const addOption = () => {
    setOptions((prev) => [...prev, { id: generateId(), medium: 'lightning', value: '' }]);
  };

  const removeOption = (id: string) => {
    setOptions((prev) => prev.filter((o) => o.id !== id));
  };

  const updateOption = (id: string, patch: Partial<DraftOption>) => {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const resetForm = () => {
    setAmountSats(order.amountSats);
    setOptions([{ id: generateId(), medium: 'lightning', value: '' }]);
    setExpirationMinutes('');
    setNote('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allValid) return;

    try {
      await sendPaymentRequest({
        orderId: order.orderId,
        buyerPubkey: order.buyerPubkey,
        amountSats,
        paymentOptions: options.map((o) => ({
          medium: o.medium,
          reference: o.value.trim(),
          value: o.value.trim(),
        })),
        expiration,
        note: note || undefined,
      });

      toast({ title: 'Payment request sent' });
      onOpenChange(false);
      resetForm();
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error instanceof Error ? error.message : 'Could not send payment request',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request payment</DialogTitle>
          <DialogDescription>
            Send a structured payment request for order {order.orderId}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (sats)</Label>
            <Input
              id="amount"
              type="number"
              min={1}
              value={amountSats}
              onChange={(e) => {
                const value = Number(e.target.value);
                setAmountSats(Number.isNaN(value) || value < 1 ? 1 : value);
              }}
            />
            <p className="text-xs text-muted-foreground">Original order: {formatSats(order.amountSats)} sats</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Payment options</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addOption}>
                <Plus className="size-4 mr-1" />
                Add option
              </Button>
            </div>

            {options.map((option, index) => {
              const medium = MEDIUM_OPTIONS.find((m) => m.value === option.medium);
              return (
                <div key={option.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Select
                      value={option.medium}
                      onValueChange={(value) =>
                        updateOption(option.id, { medium: value as GammaPaymentMedium })
                      }
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MEDIUM_OPTIONS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {options.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-8 w-8"
                        onClick={() => removeOption(option.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  <Input
                    value={option.value}
                    onChange={(e) => updateOption(option.id, { value: e.target.value })}
                    placeholder={medium?.placeholder}
                    aria-label={`Payment option ${index + 1}`}
                  />
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label htmlFor="expiration">Expires in (minutes)</Label>
            <Input
              id="expiration"
              type="number"
              min={1}
              value={expirationMinutes}
              onChange={(e) => setExpirationMinutes(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note to the buyer"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!allValid || isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
