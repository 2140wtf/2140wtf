import { useMemo, useState } from 'react';
import {
  Banknote,
  Check,
  Loader2,
  Package,
  Receipt,
  Truck,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGammaOrderActions } from '@/hooks/useGammaOrderActions';
import { useGammaOrder } from '@/hooks/useGammaOrders';
import { RequestPaymentDialog } from '@/components/RequestPaymentDialog';
import { PayOrderDialog } from '@/components/PayOrderDialog';
import { formatSats } from '@/lib/bitcoin';
import {
  isGammaOrderCreation,
  isGammaPaymentRequest,
  isGammaShippingUpdate,
  isGammaStatusUpdate,
  parseGammaOrderMessage,
  parseGammaPaymentReceipt,
  type GammaOrderCreation,
  type GammaOrderMessage,
  type GammaOrderStatus,
  type GammaPaymentReceipt,
  type GammaPaymentRequest,
  type GammaShippingUpdate,
  type GammaStatusUpdate,
} from '@/lib/gammaMarkets';
import type { Nip17Message } from '@/lib/nip17';
import { timeAgo } from '@/lib/timeAgo';
import { cn } from '@/lib/utils';

interface OrderMessageCardProps {
  message: Nip17Message;
  isMe: boolean;
}

const statusVariant: Record<GammaOrderStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  confirmed: 'default',
  processing: 'default',
  completed: 'default',
  cancelled: 'destructive',
};

type CardType = GammaOrderMessage['type'] | 'receipt';

function OrderIcon({ type }: { type: CardType }) {
  switch (type) {
    case 1:
      return <Package className="size-4" />;
    case 2:
      return <Banknote className="size-4" />;
    case 3:
      return <Check className="size-4" />;
    case 4:
      return <Truck className="size-4" />;
    default:
      return <Receipt className="size-4" />;
  }
}

function OrderTitle({ type }: { type: CardType }) {
  switch (type) {
    case 1:
      return 'New order';
    case 2:
      return 'Payment request';
    case 3:
      return 'Status update';
    case 4:
      return 'Shipping update';
    default:
      return 'Payment receipt';
  }
}

/**
 * Renders a Gamma Markets order message (kind 16) or payment receipt (kind 17)
 * inside a DM thread. Merchants can confirm or cancel an order directly from the
 * creation card; all other message types are shown read-only.
 */
export function OrderMessageCard({ message, isMe }: OrderMessageCardProps) {
  const { user } = useCurrentUser();
  const { updateStatus, isPending } = useGammaOrderActions();
  const [requestOpen, setRequestOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const parsed = useMemo(
    () => parseGammaOrderMessage(message) ?? parseGammaPaymentReceipt(message),
    [message],
  );

  const { order } = useGammaOrder(parsed?.orderId);

  if (!parsed) return null;

  const type: CardType = 'type' in parsed ? parsed.type : 'receipt';
  const counterpartyPubkey =
    message.recipients[0] === user?.pubkey ? message.sender : message.recipients[0];

  const handleStatus = async (status: GammaOrderStatus) => {
    if (!counterpartyPubkey || !user) return;
    await updateStatus({
      orderId: parsed.orderId,
      recipientPubkey: counterpartyPubkey,
      status,
    });
  };

  let creation: GammaOrderCreation | null = null;
  let paymentRequest: GammaPaymentRequest | null = null;
  let statusUpdate: GammaStatusUpdate | null = null;
  let shippingUpdate: GammaShippingUpdate | null = null;
  let receipt: GammaPaymentReceipt | null = null;

  if ('type' in parsed) {
    if (isGammaOrderCreation(parsed)) creation = parsed;
    else if (isGammaPaymentRequest(parsed)) paymentRequest = parsed;
    else if (isGammaStatusUpdate(parsed)) statusUpdate = parsed;
    else if (isGammaShippingUpdate(parsed)) shippingUpdate = parsed;
  } else {
    receipt = parsed;
  }

  const isMerchant = creation ? user?.pubkey === creation.merchantPubkey : false;
  const isBuyer = paymentRequest ? user?.pubkey === paymentRequest.buyerPubkey : false;
  const canRequestPayment =
    isMerchant &&
    order &&
    !order.paymentRequest &&
    (order.status === 'pending' || order.status === 'confirmed');
  const canPay =
    paymentRequest &&
    isBuyer &&
    !order?.receipt &&
    (order?.status === 'pending' || order?.status === 'confirmed' || order?.status === 'processing');

  return (
    <div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
      <Card
        className={cn(
          'max-w-[90%] sm:max-w-[80%] rounded-2xl border shadow-sm',
          isMe
            ? 'bg-primary text-primary-foreground rounded-br-md border-primary'
            : 'bg-card rounded-bl-md',
        )}
      >
        <CardHeader className="px-4 py-3 pb-0">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center justify-center size-7 rounded-full',
                isMe ? 'bg-primary-foreground/20' : 'bg-muted',
              )}
            >
              <OrderIcon type={type} />
            </div>
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  'text-sm font-medium truncate',
                  isMe ? 'text-primary-foreground' : 'text-foreground',
                )}
              >
                <OrderTitle type={type} />
              </p>
              <p
                className={cn(
                  'text-[10px]',
                  isMe ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                {timeAgo(message.createdAt)}
              </p>
            </div>
            {statusUpdate && (
              <Badge variant={statusVariant[statusUpdate.status]} className="text-[10px]">
                {statusUpdate.status}
              </Badge>
            )}
            {shippingUpdate && (
              <Badge variant="outline" className="text-[10px]">
                {shippingUpdate.status}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="px-4 py-3 space-y-3">
          {/* Amount for creation, payment request, receipt */}
          {(creation || paymentRequest || receipt) && (
            <div>
              <p
                className={cn(
                  'text-2xl font-bold',
                  isMe ? 'text-primary-foreground' : 'text-foreground',
                )}
              >
                {formatSats(
                  creation?.amountSats ?? paymentRequest?.amountSats ?? receipt?.amountSats ?? 0,
                )}{' '}
                sats
              </p>
              <p
                className={cn(
                  'text-xs',
                  isMe ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                Order {parsed.orderId}
              </p>
            </div>
          )}

          {/* Items */}
          {creation && creation.items.length > 0 && (
            <div className="space-y-1">
              {creation.items.map((item, index) => (
                <p
                  key={`${item.listingAddress}-${index}`}
                  className={cn(
                    'text-sm',
                    isMe ? 'text-primary-foreground/90' : 'text-foreground',
                  )}
                >
                  ×{item.quantity} {item.listingAddress}
                </p>
              ))}
            </div>
          )}

          {/* Payment options */}
          {paymentRequest && paymentRequest.paymentOptions.length > 0 && (
            <div className="space-y-1.5">
              <p
                className={cn(
                  'text-xs font-medium',
                  isMe ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}
              >
                Accepted payment methods
              </p>
              {paymentRequest.paymentOptions.map((option, index) => (
                <div
                  key={`${option.medium}-${index}`}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-xs break-all',
                    isMe
                      ? 'border-primary-foreground/20 bg-primary-foreground/10'
                      : 'border-border bg-muted/50',
                  )}
                >
                  <span className="font-medium capitalize">{option.medium}</span>
                  <span
                    className={cn(
                      'ml-2',
                      isMe ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {option.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Receipt payments */}
          {receipt && receipt.payments.length > 0 && (
            <div className="space-y-1.5">
              <p
                className={cn(
                  'text-xs font-medium',
                  isMe ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}
              >
                Payments
              </p>
              {receipt.payments.map((payment, index) => (
                <div
                  key={`${payment.medium}-${index}`}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-xs break-all',
                    isMe
                      ? 'border-primary-foreground/20 bg-primary-foreground/10'
                      : 'border-border bg-muted/50',
                  )}
                >
                  <span className="font-medium capitalize">{payment.medium}</span>
                  <span
                    className={cn(
                      'ml-2',
                      isMe ? 'text-primary-foreground/80' : 'text-muted-foreground',
                    )}
                  >
                    {payment.reference}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Shipping info */}
          {shippingUpdate && (shippingUpdate.tracking || shippingUpdate.carrier || shippingUpdate.eta) && (
            <div
              className={cn(
                'text-sm space-y-1',
                isMe ? 'text-primary-foreground/90' : 'text-foreground',
              )}
            >
              {shippingUpdate.carrier && <p>Carrier: {shippingUpdate.carrier}</p>}
              {shippingUpdate.tracking && <p>Tracking: {shippingUpdate.tracking}</p>}
              {shippingUpdate.eta && <p>ETA: {timeAgo(shippingUpdate.eta)}</p>}
            </div>
          )}

          {/* Note */}
          {'note' in parsed && parsed.note && (
            <>
              <Separator className={isMe ? 'bg-primary-foreground/20' : undefined} />
              <p
                className={cn(
                  'text-sm whitespace-pre-wrap break-words',
                  isMe ? 'text-primary-foreground/90' : 'text-foreground',
                )}
              >
                {parsed.note}
              </p>
            </>
          )}

          {/* Merchant actions on order creation */}
          {creation && isMerchant && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant={isMe ? 'secondary' : 'default'}
                disabled={isPending}
                onClick={() => void handleStatus('confirmed')}
              >
                {isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                <span className="ml-1">Confirm</span>
              </Button>
              <Button
                size="sm"
                variant={isMe ? 'secondary' : 'outline'}
                disabled={isPending}
                onClick={() => void handleStatus('cancelled')}
              >
                <X className="size-3.5" />
                <span className="ml-1">Cancel</span>
              </Button>
              <Button
                size="sm"
                variant={isMe ? 'secondary' : 'outline'}
                disabled={isPending || !canRequestPayment}
                onClick={() => setRequestOpen(true)}
              >
                <Banknote className="size-3.5" />
                <span className="ml-1">Request payment</span>
              </Button>
            </div>
          )}

          {creation && order && (
            <RequestPaymentDialog
              order={order}
              open={requestOpen}
              onOpenChange={setRequestOpen}
            />
          )}

          {/* Buyer cancel action */}
          {creation && !isMerchant && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant={isMe ? 'secondary' : 'outline'}
                disabled={isPending}
                onClick={() => void handleStatus('cancelled')}
              >
                <X className="size-3.5" />
                <span className="ml-1">Cancel order</span>
              </Button>
            </div>
          )}

          {/* Buyer pay action on payment request */}
          {paymentRequest && canPay && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant={isMe ? 'secondary' : 'default'}
                disabled={isPending}
                onClick={() => setPayOpen(true)}
              >
                <Banknote className="size-3.5" />
                <span className="ml-1">Pay</span>
              </Button>
            </div>
          )}

          {paymentRequest && (
            <PayOrderDialog
              paymentRequest={paymentRequest}
              open={payOpen}
              onOpenChange={setPayOpen}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}


