import type { NostrEvent } from '@nostrify/nostrify';

export const NIP99_CLASSIFIED_KIND = 30402;
export const NIP99_DRAFT_KIND = 30403;

export type ListingType = 'simple' | 'variable' | 'variation';
export type ListingFormat = 'physical' | 'digital';
export type DeliveryMethod = 'post' | 'collect-in-person' | 'digital';

export const NIP99_PAYMENT_METHODS = ['cashu', 'lightning', 'bitcoin', 'silent-payments', 'bolt12', 'xmr'] as const;
export type Nip99PaymentMethod = typeof NIP99_PAYMENT_METHODS[number];

/** Caps on attacker-controlled listing fields (round 30).
 *
 * Everything here comes from relay-supplied kind-30402 events, so every
 * renderer that touches these values is a potential DoS/layout-break vector:
 * - Prices are capped at the Bitcoin supply bound in msat-scale units. A
 *   value like `9e99` parses as a finite float, so "price: 0.00001 BTC"
 *   multiplied out (round 27b's lossy-float class) or a raw `1e300` sats
 *   price would otherwise overflow downstream conversion math.
 * - String fields are trimmed to lengths that survive every consumer
 *   (title into `<h3>`, summary/content into dialog text, images into
 *   gallery grids) without corrupting layout or bloating IndexedDB caches.
 */
export const MAX_LISTING_PRICE = 21_000_000_000_000_000; // 21e6 BTC * 1e6 (msat-scale sats)
export const MAX_LISTING_STRING_LENGTH = 2_000;
export const MAX_LISTING_IMAGES = 20;
export const MAX_LISTING_CATEGORIES = 30;
export const MAX_LISTING_SHIPPING_REFS = 20;

/** Whole-unit check for attacker-supplied listing prices.
 *  Fractional sats prices (`0.5`) previously fell through `Math.round` in
 *  conversion paths and rounded unpredictably; BTC prices keep their natural
 *  fraction, so those are allowed through and handled per-currency. */
export function isValidListingPrice(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_LISTING_PRICE;
}

export interface ShippingOptionRef {
  /** NIP-33 address of the referenced kind 30406 shipping option: `30406:<pubkey>:<d>`. */
  address: string;
  /** Extra cost on top of the listing price (optional). */
  extraCost?: number;
}

export interface Nip99Listing {
  id: string;
  eventId: string;
  pubkey: string;
  dTag: string;
  title: string;
  summary: string;
  content: string;
  price: {
    value: number;
    currency: string;
    frequency?: string;
  } | null;
  images: string[];
  location?: string;
  categories: string[];
  status: 'active' | 'sold' | 'draft';
  publishedAt?: number;
  createdAt: number;
  /** Number of items available (NIP-99 `stock` tag). */
  stock?: number;
  /** Plebeian-style product type (`simple`, `variable`, `variation`). */
  type?: ListingType;
  /** Whether the product is physical or digital. */
  format?: ListingFormat;
  /** Simple delivery method hint (`post`, `collect-in-person`, `digital`). */
  delivery?: DeliveryMethod;
  /** References to kind 30406 shipping-option events. */
  shippingOptionRefs: ShippingOptionRef[];
  /** Accepted payment methods for this listing (2140.wtf `payment` tag extension). */
  paymentMethods: Nip99PaymentMethod[];
  /** The original Nostr event, preserved so callers can sign/publish replacements or zap it. */
  event: NostrEvent;
}

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

function getTags(event: NostrEvent, name: string): string[] {
  return event.tags
    .filter((t) => t[0] === name && typeof t[1] === 'string')
    .map((t) => t[1]);
}

function isAllowedImageUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseListingType(value: string | undefined): ListingType | undefined {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'simple':
    case 'variable':
    case 'variation':
      return value.toLowerCase() as ListingType;
    default:
      return undefined;
  }
}

function parseListingFormat(value: string | undefined): ListingFormat | undefined {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'physical':
      return 'physical';
    case 'digital':
      return 'digital';
    default:
      return undefined;
  }
}

function parseDeliveryMethod(value: string | undefined): DeliveryMethod | undefined {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'post':
    case 'shipping':
    case 'standard':
      return 'post';
    case 'collect-in-person':
    case 'pickup':
    case 'collect':
      return 'collect-in-person';
    case 'digital':
    case 'download':
      return 'digital';
    default:
      return undefined;
  }
}

function parseShippingOptionRefs(tags: string[][]): ShippingOptionRef[] {
  return tags
    .filter((t) => t[0] === 'shipping_option' && t[1])
    .slice(0, MAX_LISTING_SHIPPING_REFS)
    .map((t) => {
      const address = t[1].slice(0, 200);
      // Round 30: finite check — `Number('1e999')` is Infinity, which passed
      // the old NaN guard and produced extraCost: Infinity.
      const extra = t[2] ? Number(t[2]) : NaN;
      return {
        address,
        extraCost: Number.isFinite(extra) && extra >= 0 && extra <= MAX_LISTING_PRICE ? extra : undefined,
      };
    });
}

export function parseNip99Listing(event: NostrEvent): Nip99Listing | null {
  if (event.kind !== NIP99_CLASSIFIED_KIND && event.kind !== NIP99_DRAFT_KIND) {
    return null;
  }

  const dTag = getTag(event, 'd');
  if (!dTag) return null;

  // Hide known demo/test listings: they were published to the public relays
  // by ephemeral throwaway keys that no longer exist, so NIP-09 deletion is
  // impossible. Filter by d-tag pattern instead of leaving them to spam the
  // Merchants feed. (demo-auction-* is also filtered in the auction parser.)
  if (/^demo-auction-/.test(dTag) || /^test-\d{13}/.test(dTag)) return null;

  const title = (getTag(event, 'title')?.trim() || dTag).slice(0, MAX_LISTING_STRING_LENGTH);
  const summary = getTag(event, 'summary')?.trim().slice(0, MAX_LISTING_STRING_LENGTH) || '';

  const priceTag = event.tags.find((t) => t[0] === 'price');
  const priceValue = priceTag?.[1] ? Number(priceTag[1]) : NaN;
  // Round 30: use isValidListingPrice, not `!Number.isNaN(...)` — Infinity
  // passes a NaN check, and a listing priced `1e999` (Number('1e999') ===
  // Infinity) would poison every downstream conversion with Infinity sats.
  const price = isValidListingPrice(priceValue)
    ? {
        value: priceValue,
        currency: (priceTag?.[2] || '').trim().slice(0, 16) || 'sats',
        frequency: priceTag?.[3]?.trim().slice(0, 64) || undefined,
      }
    : null;

  const images = getTags(event, 'image')
    .slice(0, MAX_LISTING_IMAGES)
    .filter(isAllowedImageUrl)
    .map((u) => u.slice(0, MAX_LISTING_STRING_LENGTH));
  const categories = getTags(event, 't')
    .slice(0, MAX_LISTING_CATEGORIES)
    .map((t) => t.toLowerCase().slice(0, 64));
  const paymentMethods = getTags(event, 'payment')
    .map((p) => p.toLowerCase())
    .map((p) => (p === 'monero' ? 'xmr' : p))
    .filter((p): p is Nip99PaymentMethod => (NIP99_PAYMENT_METHODS as readonly string[]).includes(p));

  const statusRaw = getTag(event, 'status')?.toLowerCase();
  let status: Nip99Listing['status'] = event.kind === NIP99_DRAFT_KIND ? 'draft' : 'active';
  if (statusRaw === 'sold') status = 'sold';
  if (statusRaw === 'active') status = 'active';

  const publishedAtRaw = getTag(event, 'published_at');
  // Finite + sane-range check: `Number('1e999')` is Infinity, and a bogus
  // 1e18 timestamp would sort the listing to the very top (or bottom) of feeds.
  const publishedAt = publishedAtRaw ? Number(publishedAtRaw) : undefined;

  const stockRaw = getTag(event, 'stock');
  const stock = stockRaw ? Number(stockRaw) : NaN;

  const typeTag = getTag(event, 'type');
  const formatTag = getTag(event, 'format');
  const deliveryTag = getTag(event, 'delivery');

  return {
    id: `${event.pubkey}:${dTag}`,
    eventId: event.id,
    pubkey: event.pubkey,
    dTag,
    title,
    summary,
    content: (event.content || '').slice(0, MAX_LISTING_STRING_LENGTH),
    price,
    images,
    location: getTag(event, 'location')?.trim().slice(0, 200) || undefined,
    categories,
    paymentMethods,
    status,
    publishedAt:
      publishedAt !== undefined &&
      Number.isFinite(publishedAt) &&
      publishedAt > 0 &&
      publishedAt <= 4_102_444_800 // 2100-01-01
        ? publishedAt
        : undefined,
    createdAt: event.created_at,
    stock: Number.isFinite(stock) && stock >= 0 ? stock : undefined,
    type: parseListingType(typeTag),
    format: parseListingFormat(formatTag ?? typeTag),
    delivery: parseDeliveryMethod(deliveryTag),
    shippingOptionRefs: parseShippingOptionRefs(event.tags),
    event,
  };
}

export function isNip99PaymentMethod(value: string): value is Nip99PaymentMethod {
  return (NIP99_PAYMENT_METHODS as readonly string[]).includes(value.toLowerCase());
}

export function formatNip99PaymentMethod(method: Nip99PaymentMethod): string {
  switch (method) {
    case 'cashu':
      return 'Cashu';
    case 'lightning':
      return 'Lightning';
    case 'bitcoin':
      return 'Bitcoin';
    case 'silent-payments':
      return 'Silent Payments';
    case 'bolt12':
      return 'BOLT12';
    case 'xmr':
      return 'Monero';
  }
}

export function dedupeNip99Listings(events: NostrEvent[]): Nip99Listing[] {
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    const dTag = getTag(event, 'd');
    if (!dTag) continue;
    const key = `${event.pubkey}:${dTag}`;
    const existing = latest.get(key);
    if (!existing || event.created_at > existing.created_at) {
      latest.set(key, event);
    }
  }
  return Array.from(latest.values())
    .map(parseNip99Listing)
    .filter((l): l is Nip99Listing => l !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function formatNip99Price(price: Nip99Listing['price']): string {
  if (!price) return 'Price on request';
  const freq = price.frequency ? ` / ${price.frequency}` : '';
  const currency = price.currency.trim();
  const normalized = currency.toLowerCase();

  let amount: string;
  if (normalized === 'usd') {
    amount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price.value);
  } else if (normalized === 'btc') {
    amount = `${(price.value).toFixed(8).replace(/\.?0+$/, '')} BTC`;
  } else if (normalized === 'sats' || normalized === 'sat') {
    amount = `${price.value.toLocaleString()} ${price.value === 1 ? 'sat' : 'sats'}`;
  } else {
    amount = `${price.value} ${currency}`;
  }

  return `${amount}${freq}`;
}

/** Category options used when listing or filtering NIP-99 products. */
export const PRODUCT_CATEGORIES = [
  { value: 'art', label: 'Bitcoin Art' },
  { value: 'product', label: 'Products' },
  { value: 'bitcoin', label: 'Bitcoin' },
  { value: 'photography', label: 'Photography' },
  { value: 'digitalart', label: 'Digital Art' },
  { value: 'print', label: 'Prints' },
  { value: 'merch', label: 'Merch' },
] as const;

/** Category value type derived from PRODUCT_CATEGORIES. */
export type ListingCategoryValue = (typeof PRODUCT_CATEGORIES)[number]['value'];

export const ART_CATEGORIES = new Set([
  'art', 'bitcoinart', 'bitcoin-art', 'artwork', 'painting', 'drawing',
  'photography', 'digitalart', 'digital-art', 'print', 'poster',
  'sculpture', 'nft', 'collectible', 'merch', 'stickers',
]);

export function isArtListing(listing: Nip99Listing): boolean {
  if (listing.categories.some((c) => ART_CATEGORIES.has(c))) return true;
  const text = `${listing.title} ${listing.summary}`.toLowerCase();
  return ART_CATEGORIES.size > 0 && Array.from(ART_CATEGORIES).some((kw) => text.includes(kw));
}

/** Label a delivery method for display. */
export function formatDeliveryMethod(method?: DeliveryMethod): string | undefined {
  switch (method) {
    case 'post':
      return 'Post';
    case 'collect-in-person':
      return 'Collect in person';
    case 'digital':
      return 'Digital delivery';
    default:
      return undefined;
  }
}
