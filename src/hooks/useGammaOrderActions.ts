import { useCallback } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDmInbox } from '@/hooks/useDmInbox';
import { useNip17SendMessage } from '@/hooks/useNip17SendMessage';
import { useToast } from '@/hooks/useToast';
import {
  buildOrderCreationPayload,
  buildPaymentReceiptPayload,
  buildPaymentRequestPayload,
  buildShippingUpdatePayload,
  buildStatusUpdatePayload,
  generateOrderId,
  type GammaOrderItem,
  type GammaOrderStatus,
  type GammaPaymentMedium,
  type GammaShippingStatus,
} from '@/lib/gammaMarkets';
import { parseNip17Rumor } from '@/lib/nip17';

interface PaymentOptionInput {
  medium: GammaPaymentMedium;
  reference: string;
  value: string;
  expiration?: number;
}

interface ReceiptPaymentInput {
  medium: GammaPaymentMedium;
  reference: string;
  proof: string;
}

/**
 * Actions for the Gamma Markets order lifecycle over NIP-17 gift-wrapped DMs.
 *
 * Every action sends a structured kind 16 (order) or kind 17 (receipt) inner
 * event to the counterparty and adds the resulting rumor to the local DM inbox
 * so the thread updates immediately.
 */
export function useGammaOrderActions() {
  const { sendMessage, isPending } = useNip17SendMessage();
  const { user } = useCurrentUser();
  const { addMessage } = useDmInbox();
  const { toast } = useToast();

  const trackSent = useCallback(
    async (promise: ReturnType<typeof sendMessage>) => {
      try {
        const result = await promise;
        const parsed = parseNip17Rumor(result.rumor, result.rumor.id);
        if (parsed) addMessage(parsed);
        return result;
      } catch (error) {
        toast({
          title: 'Message failed',
          description: error instanceof Error ? error.message : 'Could not send order update',
          variant: 'destructive',
        });
        throw error;
      }
    },
    [addMessage, toast],
  );

  const createOrder = useCallback(
    async (args: {
      merchantPubkey: string;
      amountSats: number;
      items: GammaOrderItem[];
      shippingOptionAddress?: string;
      shippingAddress?: string;
      note?: string;
    }) => {
      if (!user) throw new Error('Log in to create an order');

      const orderId = generateOrderId();
      const { content, subject, extraTags } = buildOrderCreationPayload(
        orderId,
        args.merchantPubkey,
        args.amountSats,
        args.items,
        {
          shippingOptionAddress: args.shippingOptionAddress,
          shippingAddress: args.shippingAddress,
          note: args.note,
        },
      );

      await trackSent(
        sendMessage({
          recipientPubkey: args.merchantPubkey,
          content,
          kind: 16,
          subject,
          extraTags,
        }),
      );

      return { orderId };
    },
    [user, sendMessage, trackSent],
  );

  const sendPaymentRequest = useCallback(
    async (args: {
      orderId: string;
      buyerPubkey: string;
      amountSats: number;
      paymentOptions: PaymentOptionInput[];
      expiration?: number;
      note?: string;
    }) => {
      if (!user) throw new Error('Log in to request payment');

      const { content, subject, extraTags } = buildPaymentRequestPayload(
        args.orderId,
        args.buyerPubkey,
        args.amountSats,
        args.paymentOptions,
        { expiration: args.expiration, note: args.note },
      );

      await trackSent(
        sendMessage({
          recipientPubkey: args.buyerPubkey,
          content,
          kind: 16,
          subject,
          extraTags,
        }),
      );
    },
    [user, sendMessage, trackSent],
  );

  const updateStatus = useCallback(
    async (args: {
      orderId: string;
      recipientPubkey: string;
      status: GammaOrderStatus;
      note?: string;
    }) => {
      if (!user) throw new Error('Log in to update order status');

      const { content, subject, extraTags } = buildStatusUpdatePayload(
        args.orderId,
        args.status,
        { note: args.note },
      );

      await trackSent(
        sendMessage({
          recipientPubkey: args.recipientPubkey,
          content,
          kind: 16,
          subject,
          extraTags,
        }),
      );
    },
    [user, sendMessage, trackSent],
  );

  const updateShipping = useCallback(
    async (args: {
      orderId: string;
      buyerPubkey: string;
      status: GammaShippingStatus;
      tracking?: string;
      carrier?: string;
      eta?: number;
      note?: string;
    }) => {
      if (!user) throw new Error('Log in to update shipping');

      const { content, subject, extraTags } = buildShippingUpdatePayload(
        args.orderId,
        args.status,
        {
          tracking: args.tracking,
          carrier: args.carrier,
          eta: args.eta,
          note: args.note,
        },
      );

      await trackSent(
        sendMessage({
          recipientPubkey: args.buyerPubkey,
          content,
          kind: 16,
          subject,
          extraTags,
        }),
      );
    },
    [user, sendMessage, trackSent],
  );

  const sendReceipt = useCallback(
    async (args: {
      orderId: string;
      merchantPubkey: string;
      amountSats: number;
      payments: ReceiptPaymentInput[];
      note?: string;
    }) => {
      if (!user) throw new Error('Log in to send a receipt');

      const { content, subject, extraTags } = buildPaymentReceiptPayload(
        args.orderId,
        args.merchantPubkey,
        args.amountSats,
        args.payments,
        { note: args.note },
      );

      await trackSent(
        sendMessage({
          recipientPubkey: args.merchantPubkey,
          content,
          kind: 17,
          subject,
          extraTags,
        }),
      );
    },
    [user, sendMessage, trackSent],
  );

  return {
    createOrder,
    sendPaymentRequest,
    updateStatus,
    updateShipping,
    sendReceipt,
    isPending,
  };
}
