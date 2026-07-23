import { useState } from 'react';
import { Loader2, Truck } from 'lucide-react';

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
import type { GammaOrder, GammaShippingStatus } from '@/lib/gammaMarkets';

interface ShippingUpdateDialogProps {
  order: GammaOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHIPPING_STATUSES: { value: GammaShippingStatus; label: string }[] = [
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'exception', label: 'Exception' },
];

/**
 * Merchant-facing dialog to send a Gamma Markets kind-16 type-4 shipping update.
 */
export function ShippingUpdateDialog({
  order,
  open,
  onOpenChange,
}: ShippingUpdateDialogProps) {
  const { updateShipping, isPending } = useGammaOrderActions();
  const { toast } = useToast();

  const [status, setStatus] = useState<GammaShippingStatus>('shipped');
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('');
  const [etaMinutes, setEtaMinutes] = useState('');
  const [note, setNote] = useState('');

  const resetForm = () => {
    setStatus('shipped');
    setTracking('');
    setCarrier('');
    setEtaMinutes('');
    setNote('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const eta = etaMinutes ? Math.floor(Date.now() / 1000) + Number(etaMinutes) * 60 : undefined;
    if (etaMinutes && (eta === undefined || !Number.isFinite(eta) || eta <= 0)) return;

    try {
      await updateShipping({
        orderId: order.orderId,
        buyerPubkey: order.buyerPubkey,
        status,
        tracking: tracking || undefined,
        carrier: carrier || undefined,
        eta,
        note: note || undefined,
      });

      toast({ title: 'Shipping update sent' });
      onOpenChange(false);
      resetForm();
    } catch (error) {
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Could not send shipping update',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-5" />
            Shipping update
          </DialogTitle>
          <DialogDescription>
            Update the buyer on fulfillment for order {order.orderId}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as GammaShippingStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIPPING_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="carrier">Carrier</Label>
            <Input
              id="carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="e.g. USPS"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tracking">Tracking number</Label>
            <Input
              id="tracking"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="Tracking reference"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="eta">ETA (minutes from now)</Label>
            <Input
              id="eta"
              type="number"
              min={1}
              value={etaMinutes}
              onChange={(e) => setEtaMinutes(e.target.value)}
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
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Send update
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
