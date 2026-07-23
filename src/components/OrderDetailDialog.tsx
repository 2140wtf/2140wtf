import { Eye } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { formatSats } from '@/lib/bitcoin';
import { parseListingAddress, type GammaOrder } from '@/lib/gammaMarkets';
import { timeAgo } from '@/lib/timeAgo';

interface OrderDetailDialogProps {
  order: GammaOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatListingLabel(address: string): string {
  const parsed = parseListingAddress(address);
  return parsed ? parsed.dTag : address;
}

/**
 * Read-only order summary dialog.
 *
 * Shows the full Gamma Markets order state reconstructed from the DM thread:
 * items, amounts, status, shipping info, payment request options, and receipt.
 */
export function OrderDetailDialog({ order, open, onOpenChange }: OrderDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="size-5" />
            Order {order.orderId}
          </DialogTitle>
          <DialogDescription>
            Created {timeAgo(order.createdAt)} · Updated {timeAgo(order.updatedAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="text-2xl font-bold">{formatSats(order.amountSats)} sats</p>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="capitalize">
                {order.status}
              </Badge>
              {order.shippingStatus && (
                <Badge variant="secondary" className="capitalize">
                  {order.shippingStatus}
                </Badge>
              )}
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">Items</p>
            {order.items.map((item, index) => (
              <div key={`${item.listingAddress}-${index}`} className="flex items-center justify-between text-sm">
                <span className="truncate">×{item.quantity} {formatListingLabel(item.listingAddress)}</span>
              </div>
            ))}
          </div>

          {order.shippingAddress && (
            <div className="rounded-lg border p-3 space-y-1">
              <p className="text-sm font-medium">Shipping address</p>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{order.shippingAddress}</p>
            </div>
          )}

          {order.paymentRequest && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Payment request</p>
              {order.paymentRequest.paymentOptions.map((option, index) => (
                <div key={`${option.medium}-${index}`} className="text-sm break-all">
                  <span className="capitalize font-medium">{option.medium}</span>
                  <span className="text-muted-foreground ml-2">{option.value}</span>
                </div>
              ))}
            </div>
          )}

          {order.receipt && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">Payment receipt</p>
              {order.receipt.payments.map((payment, index) => (
                <div key={`${payment.medium}-${index}`} className="text-sm break-all">
                  <span className="capitalize font-medium">{payment.medium}</span>
                  <span className="text-muted-foreground ml-2">{payment.reference}</span>
                  <p className="text-xs text-muted-foreground">Proof: {payment.proof}</p>
                </div>
              ))}
            </div>
          )}

          {order.shippingStatus && (order.carrier || order.tracking || order.eta) && (
            <div className="rounded-lg border p-3 space-y-1 text-sm">
              <p className="font-medium">Shipping</p>
              {order.carrier && <p>Carrier: {order.carrier}</p>}
              {order.tracking && <p>Tracking: {order.tracking}</p>}
              {order.eta && <p>ETA: {timeAgo(order.eta)}</p>}
            </div>
          )}

          {order.buyerNote && (
            <>
              <Separator />
              <div className="space-y-1">
                <p className="text-sm font-medium">Note</p>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{order.buyerNote}</p>
              </div>
            </>
          )}

          <Button className="w-full" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
