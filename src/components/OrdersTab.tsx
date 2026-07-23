import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Package } from 'lucide-react';
import { nip19 } from 'nostr-tools';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGammaOrders } from '@/hooks/useGammaOrders';
import { formatSats } from '@/lib/bitcoin';
import { parseListingAddress } from '@/lib/gammaMarkets';
import { timeAgo } from '@/lib/timeAgo';

interface OrdersTabProps {
  pubkey: string;
}

function formatListingLabel(address: string): string {
  const parsed = parseListingAddress(address);
  return parsed ? parsed.dTag : address;
}

function OrdersSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Profile tab that lists all Gamma Markets orders involving the viewed pubkey.
 *
 * When viewing your own profile this shows every order you have placed or
 * received; on another user's profile it filters to orders between you and
 * them (if any).
 */
export function OrdersTab({ pubkey }: OrdersTabProps) {
  const { user } = useCurrentUser();
  const { orders, isLoading } = useGammaOrders(pubkey);
  const navigate = useNavigate();

  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => b.updatedAt - a.updatedAt),
    [orders],
  );

  if (isLoading) return <OrdersSkeleton />;

  if (sortedOrders.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Package className="size-12 mx-auto mb-4 opacity-30" />
        <p className="text-lg font-medium mb-2">No orders yet</p>
        <p className="max-w-xs mx-auto text-sm">
          Orders you place or receive will appear here once the other party has
          sent an order message.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {sortedOrders.map((order) => {
        const isBuyer = user?.pubkey === order.buyerPubkey;
        const counterparty = isBuyer ? order.merchantPubkey : order.buyerPubkey;
        const counterpartyNpub = nip19.npubEncode(counterparty);

        return (
          <div
            key={order.orderId}
            className="px-4 py-4 hover:bg-secondary/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm truncate">
                    {order.items.length > 1
                      ? `${order.items.length} items`
                      : formatListingLabel(order.listingAddress)}
                  </p>
                  <Badge variant="outline" className="text-xs capitalize">
                    {order.status}
                  </Badge>
                  {order.shippingStatus && (
                    <Badge variant="secondary" className="text-xs capitalize">
                      {order.shippingStatus}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {isBuyer ? 'You bought from' : 'Sold to'}{' '}
                  <span className="font-mono text-xs">
                    {counterparty.slice(0, 12)}…
                  </span>{' '}
                  · {formatSats(order.amountSats)} sats
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Updated {timeAgo(order.updatedAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/messages/${counterpartyNpub}`)}
              >
                <MessageSquare className="size-4 mr-1.5" />
                Thread
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
