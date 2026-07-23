import { useMemo } from 'react';

import { useDmInbox } from '@/hooks/useDmInbox';
import { aggregateGammaOrders, type GammaOrder } from '@/lib/gammaMarkets';

/**
 * Aggregate Gamma Markets order lifecycle messages from the NIP-17 DM inbox.
 *
 * Pass a pubkey to only return orders that involve that user as buyer or
 * merchant. Without a pubkey all orders for the logged-in viewer are returned.
 */
export function useGammaOrders(pubkey?: string) {
  const { conversations, isLoading } = useDmInbox();

  const orders = useMemo<GammaOrder[]>(() => {
    const allMessages = conversations.flatMap((c) => c.messages);
    const aggregated = aggregateGammaOrders(allMessages);
    if (!pubkey) return aggregated;
    return aggregated.filter(
      (o) => o.buyerPubkey === pubkey || o.merchantPubkey === pubkey,
    );
  }, [conversations, pubkey]);

  return { orders, isLoading };
}

/** Fetch a single order by id from the aggregated DM inbox. */
export function useGammaOrder(orderId: string | undefined) {
  const { orders, isLoading } = useGammaOrders();
  const order = useMemo(
    () => orders.find((o) => o.orderId === orderId),
    [orders, orderId],
  );
  return { order, isLoading };
}
