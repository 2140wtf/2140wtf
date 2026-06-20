import type { NostrEvent } from '@nostrify/nostrify';

/**
 * ₿AO MARKETS trade/order event kind.
 *
 * These events are published to the BAO relay and represent a trader's
 * orders. The amount field is denominated in signet sats on the demo
 * deployment; the same schema will be used for real Cashu-backed markets
 * later.
 */
export const BAO_TRADE_KIND = 38001;

/** Default BAO relay where trade/order events are published. */
export const BAO_RELAY_URL = 'wss://relay.bao.network';

/** Parsed BAO order event. */
export interface BaoOrderEvent {
  /** Nostr event id */
  id: string;
  /** Order id (d-tag value) */
  orderId: string;
  /** Market id */
  marketId: string;
  /** Order side */
  side: 'buy' | 'sell';
  /** Outcome identifier */
  outcomeId: string;
  /** Amount in sats */
  amount: number;
  /** Limit price (0-100) */
  price: number;
  /** Order status, e.g. "open" / "filled" / "cancelled" */
  status: string;
  /** Whether this is a demo/bot order */
  demoBot: boolean;
  /** Unix seconds when the order was created */
  createdAt: number;
  /** Raw Nostr event (optional — not available for NIP-78 derived orders) */
  raw?: NostrEvent;
}

/** Aggregated BAO trading activity for a pubkey. */
export interface BaoTradeActivity {
  /** Sum of amounts for the latest event of each active order */
  totalActiveAmount: number;
  /** Number of distinct active orders */
  activeOrderCount: number;
  /** Number of distinct markets with active orders */
  uniqueMarketCount: number;
  /** Latest parsed event per order id */
  orders: BaoOrderEvent[];
}

function getTagValue(tags: string[][], name: string): string | undefined {
  return tags.find(([n]) => n === name)?.[1];
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return Math.floor(num);
  }
  return 0;
}

function parsePrice(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function parseStatus(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    return value.toLowerCase();
  }
  return 'unknown';
}

function parseSide(value: unknown): 'buy' | 'sell' {
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v === 'buy' || v === 'sell') return v;
  }
  return 'buy';
}

/**
 * Parse a kind 38001 BAO trade/order event.
 *
 * Reads authoritative values from tags first, then falls back to the JSON
 * content object. Malformed events are skipped.
 */
export function parseBaoOrderEvent(event: NostrEvent): BaoOrderEvent | null {
  if (event.kind !== BAO_TRADE_KIND) return null;

  const tags = event.tags ?? [];

  let content: Record<string, unknown> = {};
  if (event.content) {
    try {
      content = JSON.parse(event.content) as Record<string, unknown>;
    } catch {
      // Ignore malformed content; tags are authoritative.
    }
  }

  const orderId = getTagValue(tags, 'd') ?? (typeof content.orderId === 'string' ? content.orderId : event.id);
  const marketId = getTagValue(tags, 'market') ?? (typeof content.marketId === 'string' ? content.marketId : '');
  if (!marketId) return null;

  const side = parseSide(getTagValue(tags, 'side') ?? content.side);
  const outcomeId = getTagValue(tags, 'outcome') ?? (typeof content.outcomeId === 'string' ? content.outcomeId : '');
  const amount = parseAmount(getTagValue(tags, 'amount') ?? content.amount);
  const price = parsePrice(getTagValue(tags, 'price') ?? content.price);
  const status = parseStatus(getTagValue(tags, 'status') ?? content.status);
  const demoBot =
    getTagValue(tags, 'demo_bot') === 'true' ||
    getTagValue(tags, '_demoBot') === 'true' ||
    content._demoBot === true ||
    content.demoBot === true;

  const createdAt =
    typeof content.createdAt === 'number' && Number.isFinite(content.createdAt)
      ? content.createdAt
      : event.created_at;

  return {
    id: event.id,
    orderId,
    marketId,
    side,
    outcomeId,
    amount,
    price,
    status,
    demoBot,
    createdAt,
    raw: event,
  };
}

/**
 * Aggregate a list of BAO order events into trading activity.
 *
 * For each order id (d-tag) only the most recent event is kept, so cancelled
 * or filled updates naturally replace stale orders. Active amount is the sum
 * of amounts for orders whose latest status is "open".
 */
export function aggregateBaoTradeActivity(events: NostrEvent[]): BaoTradeActivity {
  const byOrderId = new Map<string, BaoOrderEvent>();

  for (const event of events) {
    const parsed = parseBaoOrderEvent(event);
    if (!parsed) continue;

    const existing = byOrderId.get(parsed.orderId);
    if (!existing || parsed.createdAt > existing.createdAt) {
      byOrderId.set(parsed.orderId, parsed);
    }
  }

  const orders = Array.from(byOrderId.values());
  const activeOrders = orders.filter((o) => o.status === 'open');
  const markets = new Set(activeOrders.map((o) => o.marketId));

  return {
    totalActiveAmount: activeOrders.reduce((sum, o) => sum + o.amount, 0),
    activeOrderCount: activeOrders.length,
    uniqueMarketCount: markets.size,
    orders,
  };
}
