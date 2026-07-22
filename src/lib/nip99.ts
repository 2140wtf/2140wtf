import type { NostrEvent } from '@nostrify/nostrify';

export const NIP99_CLASSIFIED_KIND = 30402;
export const NIP99_DRAFT_KIND = 30403;

export type ListingType = 'simple' | 'variable' | 'variation';
export type ListingFormat = 'physical' | 'digital';
export type DeliveryMethod = 'post' | 'collect-in-person' | 'digital';

export const NIP99_PAYMENT_METHODS = ['cashu', 'lightning', 'bitcoin', 'silent-payments', 'xmr'] as const;
export type Nip99PaymentMethod = typeof NIP99_PAYMENT_METHODS[number];

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
    .map((t) => {
      const address = t[1];
      const extra = t[2] ? Number(t[2]) : NaN;
      return {
        address,
        extraCost: Number.isNaN(extra) || extra < 0 ? undefined : extra,
      };
    });
}

export function parseNip99Listing(event: NostrEvent): Nip99Listing | null {
  if (event.kind !== NIP99_CLASSIFIED_KIND && event.kind !== NIP99_DRAFT_KIND) {
    return null;
  }

  const dTag = getTag(event, 'd');
  if (!dTag) return null;

  const title = getTag(event, 'title')?.trim() || dTag;
  const summary = getTag(event, 'summary')?.trim() || '';

  const priceTag = event.tags.find((t) => t[0] === 'price');
  const priceValue = priceTag?.[1] ? Number(priceTag[1]) : NaN;
  const price = !Number.isNaN(priceValue) && priceValue >= 0
    ? {
        value: priceValue,
        currency: (priceTag?.[2] || '').trim() || 'sats',
        frequency: priceTag?.[3]?.trim() || undefined,
      }
    : null;

  const images = getTags(event, 'image').filter(isAllowedImageUrl);
  const categories = getTags(event, 't').map((t) => t.toLowerCase());
  const paymentMethods = getTags(event, 'payment')
    .map((p) => p.toLowerCase())
    .map((p) => (p === 'monero' ? 'xmr' : p))
    .filter((p): p is Nip99PaymentMethod => (NIP99_PAYMENT_METHODS as readonly string[]).includes(p));

  const statusRaw = getTag(event, 'status')?.toLowerCase();
  let status: Nip99Listing['status'] = event.kind === NIP99_DRAFT_KIND ? 'draft' : 'active';
  if (statusRaw === 'sold') status = 'sold';
  if (statusRaw === 'active') status = 'active';

  const publishedAtRaw = getTag(event, 'published_at');
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
    content: event.content || '',
    price,
    images,
    location: getTag(event, 'location')?.trim() || undefined,
    categories,
    paymentMethods,
    status,
    publishedAt: publishedAt && Number.isFinite(publishedAt) ? publishedAt : undefined,
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
