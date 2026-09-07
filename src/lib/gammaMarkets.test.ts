import { describe, expect, it } from 'vitest';

import {
  MAX_ORDER_AMOUNT_SATS,
  MAX_ORDER_QUANTITY,
  aggregateGammaOrders,
  parseGammaOrderMessage,
  parseGammaPaymentReceipt,
  type GammaOrderCreation,
} from './gammaMarkets';
import type { Nip17Message } from './nip17';

const BUYER = 'b'.repeat(64);
const MERCHANT = 'm'.repeat(64);
const STRANGER = 's'.repeat(64);

function makeMessage(overrides: Partial<Nip17Message> & { tags?: string[][] }): Nip17Message {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2, 8),
    kind: 16,
    sender: BUYER,
    recipients: [MERCHANT],
    content: '',
    createdAt: 1_700_000_000,
    tags: [],
    ...overrides,
  } as Nip17Message;
}

describe('parseGammaOrderMessage — round 30 caps', () => {
  it('accepts a well-formed order creation', () => {
    const msg = makeMessage({
      tags: [
        ['type', '1'],
        ['order', 'order-1'],
        ['amount', '21000'],
        ['item', '30402:' + MERCHANT + ':listing', '2'],
      ],
    });
    const parsed = parseGammaOrderMessage(msg);
    expect(parsed).not.toBeNull();
    if (parsed && 'type' in parsed && parsed.type === 1) {
      expect(parsed.amountSats).toBe(21000);
      expect(parsed.items).toEqual([{ listingAddress: '30402:' + MERCHANT + ':listing', quantity: 2 }]);
    }
  });

  it('rejects amounts above the supply bound', () => {
    const msg = makeMessage({
      tags: [
        ['type', '2'],
        ['order', 'order-1'],
        ['amount', String(MAX_ORDER_AMOUNT_SATS + 1)],
      ],
    });
    expect(parseGammaOrderMessage(msg)).toBeNull();
  });

  it('rejects non-finite amounts (Infinity passes old NaN-only guards)', () => {
    const msg = makeMessage({
      tags: [['type', '2'], ['order', 'order-1'], ['amount', '1e999']],
    });
    expect(parseGammaOrderMessage(msg)).toBeNull();
  });

  it('rejects item quantities above the cap', () => {
    const msg = makeMessage({
      tags: [
        ['type', '1'],
        ['order', 'order-1'],
        ['amount', '1000'],
        ['item', '30402:x:y', String(MAX_ORDER_QUANTITY + 1)],
      ],
    });
    const parsed = parseGammaOrderMessage(msg);
    // Items array empty → creation rejected (parse requires ≥1 item).
    expect(parsed).toBeNull();
  });

  it('rejects absurd eta values', () => {
    const msg = makeMessage({
      sender: MERCHANT,
      recipients: [BUYER],
      tags: [['type', '4'], ['order', 'order-1'], ['status', 'shipped'], ['eta', '9e15']],
    });
    const parsed = parseGammaOrderMessage(msg);
    if (parsed && 'type' in parsed && parsed.type === 4) {
      expect(parsed.eta).toBeUndefined();
    } else {
      throw new Error('expected shipping update');
    }
  });

  it('rejects oversized order ids', () => {
    const msg = makeMessage({
      tags: [['type', '1'], ['order', 'o'.repeat(500)], ['amount', '100'], ['item', '30402:x:y', '1']],
    });
    expect(parseGammaOrderMessage(msg)).toBeNull();
  });

  it('rejects oversized receipts (amount cap + order id cap)', () => {
    const receiptMsg: Nip17Message = makeMessage({
      kind: 17,
      sender: BUYER,
      tags: [
        ['order', 'order-1'],
        ['amount', '9e15'],
        ['payment', 'lightning', 'ref', 'proof'],
      ],
    } as Partial<Nip17Message>);
    expect(parseGammaPaymentReceipt(receiptMsg)).toBeNull();
  });
});

describe('aggregateGammaOrders — sender-role enforcement (round 30)', () => {
  const creationMsg = makeMessage({
    tags: [
      ['type', '1'],
      ['order', 'order-1'],
      ['amount', '21000'],
      ['item', '30402:' + MERCHANT + ':listing', '1'],
    ],
  });

  it('applies a legitimate merchant payment request', () => {
    const paymentRequest = makeMessage({
      sender: MERCHANT,
      recipients: [BUYER],
      createdAt: creationMsg.createdAt + 10,
      tags: [
        ['type', '2'],
        ['order', 'order-1'],
        ['amount', '21000'],
        ['payment', 'lightning', 'lnbc210n1example'],
      ],
    });
    const orders = aggregateGammaOrders([creationMsg, paymentRequest]);
    expect(orders).toHaveLength(1);
    expect(orders[0].paymentRequest).toBeDefined();
    expect(orders[0].paymentRequest!.merchantPubkey).toBe(MERCHANT);
  });

  it('ignores a FORGED payment request from a stranger', () => {
    const forged = makeMessage({
      sender: STRANGER,
      recipients: [BUYER],
      createdAt: creationMsg.createdAt + 10,
      tags: [
        ['type', '2'],
        ['order', 'order-1'],
        ['amount', '99999999'],
        ['payment', 'lightning', 'lnbc99999n1forged'],
      ],
    });
    const orders = aggregateGammaOrders([creationMsg, forged]);
    expect(orders).toHaveLength(1);
    // The forged request must NOT become the order's payment request.
    expect(orders[0].paymentRequest).toBeUndefined();
  });

  it('ignores a forged status update from a stranger', () => {
    const forgedCancel = makeMessage({
      sender: STRANGER,
      recipients: [BUYER],
      createdAt: creationMsg.createdAt + 10,
      tags: [['type', '3'], ['order', 'order-1'], ['status', 'cancelled']],
    });
    const orders = aggregateGammaOrders([creationMsg, forgedCancel]);
    expect(orders[0].status).toBe('pending');
  });

  it('ignores a forged receipt from a stranger', () => {
    const forgedReceipt = makeMessage({
      kind: 17,
      sender: STRANGER,
      recipients: [MERCHANT],
      createdAt: creationMsg.createdAt + 10,
      tags: [
        ['order', 'order-1'],
        ['amount', '21000'],
        ['payment', 'lightning', 'ref', 'preimage-forged'],
      ],
    } as Partial<Nip17Message>);
    const orders = aggregateGammaOrders([creationMsg, forgedReceipt]);
    expect(orders[0].receipt).toBeUndefined();
  });

  it('accepts a receipt from the real buyer', () => {
    const receipt = makeMessage({
      kind: 17,
      sender: BUYER,
      recipients: [MERCHANT],
      createdAt: creationMsg.createdAt + 10,
      tags: [
        ['order', 'order-1'],
        ['amount', '21000'],
        ['payment', 'lightning', 'ref', 'preimage'],
      ],
    } as Partial<Nip17Message>);
    const orders = aggregateGammaOrders([creationMsg, receipt]);
    expect(orders[0].receipt).toBeDefined();
    expect(orders[0].receipt!.payments[0].proof).toBe('preimage');
  });

  it('ignores a duplicate type-1 creation from a different buyer (order hijack)', () => {
    // A stranger replaying the same order id with themselves as "buyer" must
    // not overwrite the original creation.
    const hijack = makeMessage({
      sender: STRANGER,
      recipients: [MERCHANT],
      createdAt: creationMsg.createdAt + 5,
      tags: [
        ['type', '1'],
        ['order', 'order-1'],
        ['amount', '1'],
        ['item', '30402:' + MERCHANT + ':other', '1'],
      ],
    });
    const orders = aggregateGammaOrders([creationMsg, hijack]);
    expect((orders[0] as { buyerPubkey: string }).buyerPubkey).toBe(BUYER);
    expect(orders[0].amountSats).toBe(21000);
  });
});

describe('GammaOrderCreation shape — used by role tests', () => {
  it('documents the role fields the aggregator relies on', () => {
    // Type-level guard: the creation carries both roles.
    const creation: Pick<GammaOrderCreation, 'buyerPubkey' | 'merchantPubkey'> = {
      buyerPubkey: BUYER,
      merchantPubkey: MERCHANT,
    };
    expect(creation.buyerPubkey).toBe(BUYER);
    expect(creation.merchantPubkey).toBe(MERCHANT);
  });
});
