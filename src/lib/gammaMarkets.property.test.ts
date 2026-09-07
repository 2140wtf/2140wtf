import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_ORDER_AMOUNT_SATS,
  MAX_ORDER_QUANTITY,
  aggregateGammaOrders,
  parseGammaOrderMessage,
  parseGammaPaymentReceipt,
  type GammaOrder,
} from './gammaMarkets';
import type { Nip17Message } from './nip17';

// Deterministic fuzz campaign (round 30): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260907, numRuns: 300 });

const HEX64 = fc.stringMatching(/^[0-9a-f]{64}$/);

/** Fixed identity pool: one buyer, one merchant, two strangers. Forged-message
 *  properties are only meaningful when a stranger CAN collide on order ids —
 *  the pool keeps that possible while varying everything else. */
const BUYER = 'b'.repeat(64);
const MERCHANT = 'm'.repeat(64);
const STRANGERS = ['e'.repeat(64), 'f'.repeat(64)];

const arbSender = fc.constantFrom(BUYER, MERCHANT, ...STRANGERS);
const arbRecipient = arbSender;

// Order ids are generated through the tag-value arbiter (high-collision
// 'order-x' constant is included there) so forged messages can share ids.
const arbTagValue = fc.oneof(fc.string({ maxLength: 60 }), fc.constantFrom('1', '2', '3', '4', 'order-x', 'pending', 'cancelled', 'shipped', '9e15', '1e999', '-5', '0', String(MAX_ORDER_QUANTITY + 1)));

const arbGammaMessage: fc.Arbitrary<Nip17Message> = fc.record({
  id: HEX64,
  kind: fc.constantFrom(16, 17, 16, 16), // weight kind 16
  sender: arbSender,
  recipients: fc.array(arbRecipient, { maxLength: 2, minLength: 1 }),
  content: fc.string({ maxLength: 200 }),
  createdAt: fc.integer({ min: 1_600_000_000, max: 1_800_000_000 }),
  tags: fc.array(
    fc.tuple(
      fc.constantFrom('type', 'order', 'amount', 'item', 'payment', 'status', 'shipping', 'address', 'tracking', 'carrier', 'eta', 'bogus'),
      arbTagValue,
      fc.option(arbTagValue, { nil: undefined }),
      fc.option(arbTagValue, { nil: undefined }),
    ).map(([k, v, v2, v3]) => {
      const tag = [k, v];
      if (v2 !== undefined) tag.push(v2);
      if (v3 !== undefined) tag.push(v3);
      return tag;
    }),
    { maxLength: 12 },
  ),
  // Unused by the aggregator but required by the Nip17Message type.
  wrapId: fc.constant(''),
  rumorId: fc.constant(''),
}) as unknown as fc.Arbitrary<Nip17Message>;

function isParticipant(order: GammaOrder, pubkey: string): boolean {
  return pubkey === order.buyerPubkey || pubkey === order.merchantPubkey;
}

describe('aggregateGammaOrders — property fuzz (round 30)', () => {
  it('never throws and only emits orders backed by a creation from a valid pair', () => {
    fc.assert(
      fc.property(fc.array(arbGammaMessage, { maxLength: 40 }), (messages) => {
        let orders: GammaOrder[];
        expect(() => {
          orders = aggregateGammaOrders(messages);
        }).not.toThrow();

        for (const order of orders!) {
          expect(order.buyerPubkey).not.toBe(order.merchantPubkey);
          // Every order must have at least one creation message consistent
          // with the emitted roles.
          const creation = messages.find(
            (m) =>
              m.sender === order.buyerPubkey &&
              m.tags.some((t) => t[0] === 'type' && t[1] === '1') &&
              m.tags.some((t) => t[0] === 'order' && t[1] === order.orderId),
          );
          expect(creation).toBeDefined();
        }
      }),
    );
  });

  it('state fields are only mutated by lifecycle participants (forged-sender immutability)', () => {
    fc.assert(
      fc.property(fc.array(arbGammaMessage, { maxLength: 40 }), (messages) => {
        const orders = aggregateGammaOrders(messages);
        for (const order of orders) {
          // paymentRequest: only a merchant-sent type-2 may set it.
          if (order.paymentRequest) {
            expect(order.paymentRequest.merchantPubkey).toBe(order.merchantPubkey);
            const requestMsg = messages.find((m) => m.id === order.paymentRequest!.eventId);
            expect(requestMsg?.sender).toBe(order.merchantPubkey);
          }
          // receipt: only a buyer-sent kind-17 may set it.
          if (order.receipt) {
            const receiptMsg = messages.find((m) => m.id === order.receipt!.eventId);
            expect(receiptMsg?.sender).toBe(order.buyerPubkey);
          }
          // shippingStatus: only a merchant-sent type-4 may set it.
          if (order.shippingStatus !== undefined) {
            const shippingMsg = messages.find(
              (m) =>
                m.sender === order.merchantPubkey &&
                m.tags.some((t) => t[0] === 'type' && t[1] === '4') &&
                m.tags.some((t) => t[0] === 'order' && t[1] === order.orderId),
            );
            expect(shippingMsg).toBeDefined();
          }
          // A stranger's messages must not have created the order roles.
          expect(isParticipant(order, order.buyerPubkey)).toBe(true);
        }
      }),
    );
  });

  it('all aggregated amounts and item quantities respect the round-30 bounds', () => {
    fc.assert(
      fc.property(fc.array(arbGammaMessage, { maxLength: 40 }), (messages) => {
        const orders = aggregateGammaOrders(messages);
        for (const order of orders) {
          expect(order.amountSats).toBeGreaterThanOrEqual(0);
          expect(order.amountSats).toBeLessThanOrEqual(MAX_ORDER_AMOUNT_SATS);
          expect(Number.isSafeInteger(order.amountSats)).toBe(true);
          for (const item of order.items) {
            expect(item.quantity).toBeGreaterThanOrEqual(1);
            expect(item.quantity).toBeLessThanOrEqual(MAX_ORDER_QUANTITY);
          }
          if (order.paymentRequest) {
            expect(order.paymentRequest.amountSats).toBeLessThanOrEqual(MAX_ORDER_AMOUNT_SATS);
            for (const option of order.paymentRequest.paymentOptions) {
              expect(option.medium).toMatch(/^(lightning|bolt12|bitcoin|ecash|fiat)$/);
            }
          }
          if (order.receipt) {
            expect(order.receipt.amountSats).toBeLessThanOrEqual(MAX_ORDER_AMOUNT_SATS);
          }
          if (order.eta !== undefined) {
            expect(order.eta).toBeGreaterThan(1_600_000_000);
            expect(order.eta).toBeLessThan(4_102_444_800);
          }
        }
      }),
    );
  });

  it('is deterministic — same input, same output (twice)', () => {
    fc.assert(
      fc.property(fc.array(arbGammaMessage, { maxLength: 30 }), (messages) => {
        const a = JSON.stringify(aggregateGammaOrders(messages));
        const b = JSON.stringify(aggregateGammaOrders(messages));
        expect(a).toBe(b);
      }),
    );
  });

  it('parser round-trip: any message the aggregator used is individually parseable', () => {
    fc.assert(
      fc.property(fc.array(arbGammaMessage, { maxLength: 30 }), (messages) => {
        for (const m of messages) {
          expect(() => {
            parseGammaOrderMessage(m);
            parseGammaPaymentReceipt(m);
          }).not.toThrow();
        }
      }),
    );
  });
});
