import type { Nip17Message } from '@/lib/nip17';
import { NIP99_CLASSIFIED_KIND } from '@/lib/nip99';
import { SHIPPING_OPTION_KIND } from '@/lib/shippingOption';

/** Gamma Markets order-message types carried in kind 16 DMs. */
export type GammaOrderMessageType = 1 | 2 | 3 | 4;

/** Order lifecycle statuses from Gamma Markets kind 16 type 3 messages. */
export type GammaOrderStatus = 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled';

/** Shipping statuses from Gamma Markets kind 16 type 4 messages. */
export type GammaShippingStatus = 'processing' | 'shipped' | 'delivered' | 'exception';

/** Payment mediums supported in Gamma Markets receipt tags. */
export type GammaPaymentMedium = 'lightning' | 'bolt12' | 'bitcoin' | 'ecash' | 'fiat';

export interface GammaOrderItem {
  listingAddress: string;
  quantity: number;
}

export interface GammaOrderCreation {
  kind: 16;
  type: 1;
  orderId: string;
  buyerPubkey: string;
  merchantPubkey: string;
  amountSats: number;
  items: GammaOrderItem[];
  shippingAddress?: string;
  shippingOptionAddress?: string;
  note?: string;
  createdAt: number;
  eventId: string;
}

export interface GammaPaymentOption {
  medium: GammaPaymentMedium;
  reference: string;
  /** BOLT11 invoice, BOLT12 offer, on-chain address, ecash request, etc. */
  value: string;
  expiration?: number;
}

export interface GammaPaymentRequest {
  kind: 16;
  type: 2;
  orderId: string;
  merchantPubkey: string;
  buyerPubkey: string;
  amountSats: number;
  paymentOptions: GammaPaymentOption[];
  createdAt: number;
  eventId: string;
}

export interface GammaStatusUpdate {
  kind: 16;
  type: 3;
  orderId: string;
  senderPubkey: string;
  recipientPubkey: string;
  status: GammaOrderStatus;
  note?: string;
  createdAt: number;
  eventId: string;
}

export interface GammaShippingUpdate {
  kind: 16;
  type: 4;
  orderId: string;
  merchantPubkey: string;
  buyerPubkey: string;
  status: GammaShippingStatus;
  tracking?: string;
  carrier?: string;
  eta?: number;
  note?: string;
  createdAt: number;
  eventId: string;
}

export type GammaOrderMessage =
  | GammaOrderCreation
  | GammaPaymentRequest
  | GammaStatusUpdate
  | GammaShippingUpdate;

export function isGammaOrderCreation(message: GammaOrderMessage): message is GammaOrderCreation {
  return message.type === 1;
}

export function isGammaPaymentRequest(message: GammaOrderMessage): message is GammaPaymentRequest {
  return message.type === 2;
}

export function isGammaStatusUpdate(message: GammaOrderMessage): message is GammaStatusUpdate {
  return message.type === 3;
}

export function isGammaShippingUpdate(message: GammaOrderMessage): message is GammaShippingUpdate {
  return message.type === 4;
}

export interface GammaPaymentReceipt {
  kind: 17;
  orderId: string;
  buyerPubkey: string;
  merchantPubkey: string;
  amountSats: number;
  payments: Array<{
    medium: GammaPaymentMedium;
    reference: string;
    proof: string;
  }>;
  note?: string;
  createdAt: number;
  eventId: string;
}

/** Aggregated view of one order, reconstructed from its DM thread. */
export interface GammaOrder {
  orderId: string;
  listingAddress: string;
  buyerPubkey: string;
  merchantPubkey: string;
  amountSats: number;
  items: GammaOrderItem[];
  shippingOptionAddress?: string;
  shippingAddress?: string;
  buyerNote?: string;
  status: GammaOrderStatus;
  shippingStatus?: GammaShippingStatus;
  tracking?: string;
  carrier?: string;
  eta?: number;
  paymentRequest?: GammaPaymentRequest;
  receipt?: GammaPaymentReceipt;
  messages: Nip17Message[];
  createdAt: number;
  updatedAt: number;
}

/** Build a NIP-99 listing NIP-33 address. */
export function buildListingAddress(pubkey: string, dTag: string): string {
  return `${NIP99_CLASSIFIED_KIND}:${pubkey}:${dTag}`;
}

/** Build a kind-30406 shipping-option NIP-33 address. */
export function buildShippingOptionAddress(pubkey: string, dTag: string): string {
  return `${SHIPPING_OPTION_KIND}:${pubkey}:${dTag}`;
}

/** Generate a short, unique order id. */
export function generateOrderId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `order-${ts}-${rand}`;
}

function getTag(tags: string[][], name: string): string | undefined {
  return tags.find(([k]) => k === name)?.[1];
}

function getTags(tags: string[][], name: string): string[][] {
  return tags.filter(([k]) => k === name);
}

function parseItemTag(tag: string[]): GammaOrderItem | null {
  if (tag.length < 3) return null;
  const address = tag[1];
  const qty = Number(tag[2]);
  if (!address || !Number.isInteger(qty) || qty <= 0) return null;
  return { listingAddress: address, quantity: qty };
}

function parsePaymentOptionTag(tag: string[]): GammaPaymentOption | null {
  if (tag.length < 3) return null;
  const medium = tag[1] as GammaPaymentMedium;
  const value = tag[2];
  if (!medium || !value) return null;
  if (!isGammaPaymentMedium(medium)) return null;
  return { medium, reference: value, value };
}

function isGammaPaymentMedium(value: string): value is GammaPaymentMedium {
  return ['lightning', 'bolt12', 'bitcoin', 'ecash', 'fiat'].includes(value);
}

function parseReceiptPaymentTag(tag: string[]): GammaPaymentReceipt['payments'][number] | null {
  if (tag.length < 4) return null;
  const medium = tag[1] as GammaPaymentMedium;
  const reference = tag[2];
  const proof = tag[3];
  if (!medium || !reference || !proof || !isGammaPaymentMedium(medium)) return null;
  return { medium, reference, proof };
}

export function parseGammaOrderMessage(message: Nip17Message): GammaOrderMessage | null {
  if (message.kind !== 16) return null;
  const typeRaw = getTag(message.tags, 'type');
  const type = typeRaw ? (Number(typeRaw) as GammaOrderMessageType) : undefined;
  if (!type || !([1, 2, 3, 4] as number[]).includes(type)) return null;
  const orderId = getTag(message.tags, 'order');
  if (!orderId) return null;

  const sender = message.sender;
  const recipient = message.recipients[0];
  if (!recipient) return null;

  switch (type) {
    case 1: {
      const amountRaw = getTag(message.tags, 'amount');
      const amount = amountRaw ? Number(amountRaw) : NaN;
      if (!Number.isFinite(amount) || amount < 0) return null;
      const items = getTags(message.tags, 'item')
        .map(parseItemTag)
        .filter((i): i is GammaOrderItem => i !== null);
      if (items.length === 0) return null;
      return {
        kind: 16,
        type: 1,
        orderId,
        buyerPubkey: sender,
        merchantPubkey: recipient,
        amountSats: amount,
        items,
        shippingOptionAddress: getTag(message.tags, 'shipping') ?? undefined,
        shippingAddress: getTag(message.tags, 'address') ?? undefined,
        note: message.content || undefined,
        createdAt: message.createdAt,
        eventId: message.id,
      };
    }
    case 2: {
      const amountRaw = getTag(message.tags, 'amount');
      const amount = amountRaw ? Number(amountRaw) : NaN;
      if (!Number.isFinite(amount) || amount < 0) return null;
      const paymentOptions = getTags(message.tags, 'payment')
        .map(parsePaymentOptionTag)
        .filter((p): p is GammaPaymentOption => p !== null);
      return {
        kind: 16,
        type: 2,
        orderId,
        merchantPubkey: sender,
        buyerPubkey: recipient,
        amountSats: amount,
        paymentOptions,
        createdAt: message.createdAt,
        eventId: message.id,
      };
    }
    case 3: {
      const status = getTag(message.tags, 'status') as GammaOrderStatus | undefined;
      if (!status || !isGammaOrderStatus(status)) return null;
      return {
        kind: 16,
        type: 3,
        orderId,
        senderPubkey: sender,
        recipientPubkey: recipient,
        status,
        note: message.content || undefined,
        createdAt: message.createdAt,
        eventId: message.id,
      };
    }
    case 4: {
      const status = getTag(message.tags, 'status') as GammaShippingStatus | undefined;
      if (!status || !isGammaShippingStatus(status)) return null;
      const etaRaw = getTag(message.tags, 'eta');
      return {
        kind: 16,
        type: 4,
        orderId,
        merchantPubkey: sender,
        buyerPubkey: recipient,
        status,
        tracking: getTag(message.tags, 'tracking') ?? undefined,
        carrier: getTag(message.tags, 'carrier') ?? undefined,
        eta: etaRaw ? Number(etaRaw) : undefined,
        note: message.content || undefined,
        createdAt: message.createdAt,
        eventId: message.id,
      };
    }
    default:
      return null;
  }
}

export function parseGammaPaymentReceipt(message: Nip17Message): GammaPaymentReceipt | null {
  if (message.kind !== 17) return null;
  const orderId = getTag(message.tags, 'order');
  if (!orderId) return null;
  const amountRaw = getTag(message.tags, 'amount');
  const amount = amountRaw ? Number(amountRaw) : NaN;
  if (!Number.isFinite(amount) || amount < 0) return null;
  const payments = getTags(message.tags, 'payment')
    .map(parseReceiptPaymentTag)
    .filter((p): p is GammaPaymentReceipt['payments'][number] => p !== null);
  if (payments.length === 0) return null;
  return {
    kind: 17,
    orderId,
    buyerPubkey: message.sender,
    merchantPubkey: message.recipients[0] ?? '',
    amountSats: amount,
    payments,
    note: message.content || undefined,
    createdAt: message.createdAt,
    eventId: message.id,
  };
}

function isGammaOrderStatus(value: string): value is GammaOrderStatus {
  return ['pending', 'confirmed', 'processing', 'completed', 'cancelled'].includes(value);
}

function isGammaShippingStatus(value: string): value is GammaShippingStatus {
  return ['processing', 'shipped', 'delivered', 'exception'].includes(value);
}

/** Build the tag/content payload for a kind 16 type 1 order creation message. */
export function buildOrderCreationPayload(
  orderId: string,
  merchantPubkey: string,
  amountSats: number,
  items: GammaOrderItem[],
  opts?: {
    shippingOptionAddress?: string;
    shippingAddress?: string;
    note?: string;
  },
): { content: string; subject: string; extraTags: string[][] } {
  const tags: string[][] = [
    ['type', '1'],
    ['order', orderId],
    ['amount', String(amountSats)],
    ...items.map((i): [string, string, string] => ['item', i.listingAddress, String(i.quantity)]),
  ];
  if (opts?.shippingOptionAddress) tags.push(['shipping', opts.shippingOptionAddress]);
  if (opts?.shippingAddress) tags.push(['address', opts.shippingAddress]);
  return {
    content: opts?.note ?? '',
    subject: `New order ${orderId}`,
    extraTags: tags,
  };
}

/** Build the tag/content payload for a kind 16 type 2 payment request message. */
export function buildPaymentRequestPayload(
  orderId: string,
  buyerPubkey: string,
  amountSats: number,
  paymentOptions: GammaPaymentOption[],
  opts?: { expiration?: number; note?: string },
): { content: string; subject: string; extraTags: string[][] } {
  const tags: string[][] = [
    ['type', '2'],
    ['order', orderId],
    ['amount', String(amountSats)],
    ...paymentOptions.map((p): [string, string, string] => ['payment', p.medium, p.value]),
  ];
  if (opts?.expiration) tags.push(['expiration', String(opts.expiration)]);
  return {
    content: opts?.note ?? '',
    subject: `Payment request ${orderId}`,
    extraTags: tags,
  };
}

/** Build the tag/content payload for a kind 16 type 3 status update message. */
export function buildStatusUpdatePayload(
  orderId: string,
  status: GammaOrderStatus,
  opts?: { note?: string },
): { content: string; subject: string; extraTags: string[][] } {
  return {
    content: opts?.note ?? '',
    subject: `Order status ${orderId}`,
    extraTags: [
      ['type', '3'],
      ['order', orderId],
      ['status', status],
    ],
  };
}

/** Build the tag/content payload for a kind 16 type 4 shipping update message. */
export function buildShippingUpdatePayload(
  orderId: string,
  status: GammaShippingStatus,
  opts?: { tracking?: string; carrier?: string; eta?: number; note?: string },
): { content: string; subject: string; extraTags: string[][] } {
  const tags: string[][] = [
    ['type', '4'],
    ['order', orderId],
    ['status', status],
  ];
  if (opts?.tracking) tags.push(['tracking', opts.tracking]);
  if (opts?.carrier) tags.push(['carrier', opts.carrier]);
  if (opts?.eta) tags.push(['eta', String(opts.eta)]);
  return {
    content: opts?.note ?? '',
    subject: `Shipping update ${orderId}`,
    extraTags: tags,
  };
}

/** Build the tag/content payload for a kind 17 payment receipt message. */
export function buildPaymentReceiptPayload(
  orderId: string,
  merchantPubkey: string,
  amountSats: number,
  payments: GammaPaymentReceipt['payments'],
  opts?: { note?: string },
): { content: string; subject: string; extraTags: string[][] } {
  return {
    content: opts?.note ?? '',
    subject: `Payment receipt ${orderId}`,
    extraTags: [
      ['order', orderId],
      ['amount', String(amountSats)],
      ...payments.map((p): [string, string, string, string] => ['payment', p.medium, p.reference, p.proof]),
    ],
  };
}

/** Aggregate all order-related messages into per-order state. */
export function aggregateGammaOrders(messages: Nip17Message[]): GammaOrder[] {
  const byOrder = new Map<string, { creation?: GammaOrderCreation; messages: Nip17Message[] }>();

  for (const message of messages) {
    const parsed = parseGammaOrderMessage(message) ?? parseGammaPaymentReceipt(message);
    if (!parsed) continue;
    const entry = byOrder.get(parsed.orderId) ?? { messages: [] };
    if ('type' in parsed && parsed.type === 1) {
      entry.creation = parsed;
    }
    entry.messages.push(message);
    byOrder.set(parsed.orderId, entry);
  }

  const orders: GammaOrder[] = [];
  for (const [orderId, entry] of byOrder) {
    if (!entry.creation) continue;
    const creation = entry.creation;
    const order: GammaOrder = {
      orderId,
      listingAddress: creation.items[0]?.listingAddress ?? '',
      buyerPubkey: creation.buyerPubkey,
      merchantPubkey: creation.merchantPubkey,
      amountSats: creation.amountSats,
      items: creation.items,
      shippingOptionAddress: creation.shippingOptionAddress,
      shippingAddress: creation.shippingAddress,
      buyerNote: creation.note,
      status: 'pending',
      messages: entry.messages,
      createdAt: creation.createdAt,
      updatedAt: creation.createdAt,
    };

    for (const msg of entry.messages) {
      const parsed = parseGammaOrderMessage(msg) ?? parseGammaPaymentReceipt(msg);
      if (!parsed) continue;
      order.updatedAt = Math.max(order.updatedAt, parsed.createdAt);

      if ('type' in parsed) {
        if (parsed.type === 2) order.paymentRequest = parsed;
        if (parsed.type === 3) {
          order.status = parsed.status;
          if (parsed.note) order.buyerNote = parsed.note;
        }
        if (parsed.type === 4) {
          order.shippingStatus = parsed.status;
          if (parsed.tracking) order.tracking = parsed.tracking;
          if (parsed.carrier) order.carrier = parsed.carrier;
          if (parsed.eta) order.eta = parsed.eta;
        }
      } else {
        order.receipt = parsed;
      }
    }

    orders.push(order);
  }

  return orders.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Return true if a NIP-17 message is a Gamma Markets order or receipt event. */
export function isGammaOrderMessage(message: Nip17Message): boolean {
  return message.kind === 16 || message.kind === 17;
}

/** Return the NIP-33 d-tag from a listing address, or undefined. */
export function parseListingAddress(address: string): { kind: number; pubkey: string; dTag: string } | undefined {
  const parts = address.split(':');
  if (parts.length !== 3) return undefined;
  const kind = Number(parts[0]);
  if (!Number.isInteger(kind)) return undefined;
  return { kind, pubkey: parts[1], dTag: parts[2] };
}
