import type { NostrEvent } from '@nostrify/nostrify';

export const SHIPPING_OPTION_KIND = 30406;

export type ShippingOptionService =
  | 'standard'
  | 'express'
  | 'overnight'
  | 'pickup'
  | 'digital';

export interface ShippingOption {
  id: string;
  eventId: string;
  pubkey: string;
  dTag: string;
  title: string;
  price: {
    value: number;
    currency: string;
    frequency?: string;
  } | null;
  service: ShippingOptionService;
  location?: string;
  country?: string;
  duration?: string;
  createdAt: number;
  event: NostrEvent;
}

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

function parseService(value: string | undefined): ShippingOptionService | undefined {
  if (!value) return undefined;
  switch (value.toLowerCase()) {
    case 'standard':
    case 'express':
    case 'overnight':
    case 'pickup':
    case 'digital':
      return value.toLowerCase() as ShippingOptionService;
    default:
      return undefined;
  }
}

/** Build the NIP-33 address for a kind 30406 shipping option. */
export function shippingOptionAddress(pubkey: string, dTag: string): string {
  return `${SHIPPING_OPTION_KIND}:${pubkey}:${dTag}`;
}

/** Parse a NIP-33 address string into its components. */
export function parseShippingOptionAddress(
  address: string,
): { kind: number; pubkey: string; dTag: string } | null {
  const parts = address.split(':');
  if (parts.length !== 3) return null;
  const kind = Number(parts[0]);
  if (Number.isNaN(kind)) return null;
  return { kind, pubkey: parts[1], dTag: parts[2] };
}

export function parseShippingOption(event: NostrEvent): ShippingOption | null {
  if (event.kind !== SHIPPING_OPTION_KIND) return null;

  const dTag = getTag(event, 'd');
  if (!dTag) return null;

  const title = getTag(event, 'title')?.trim();
  if (!title) return null;

  const service = parseService(getTag(event, 'service'));
  if (!service) return null;

  const priceTag = event.tags.find((t) => t[0] === 'price');
  const priceValue = priceTag?.[1] ? Number(priceTag[1]) : NaN;
  const price = !Number.isNaN(priceValue) && priceValue >= 0
    ? {
        value: priceValue,
        currency: (priceTag?.[2] || '').trim() || 'sats',
        frequency: priceTag?.[3]?.trim() || undefined,
      }
    : null;

  return {
    id: `${event.pubkey}:${dTag}`,
    eventId: event.id,
    pubkey: event.pubkey,
    dTag,
    title,
    price,
    service,
    location: getTag(event, 'location')?.trim() || undefined,
    country: getTag(event, 'country')?.trim() || undefined,
    duration: getTag(event, 'duration')?.trim() || undefined,
    createdAt: event.created_at,
    event,
  };
}

export function dedupeShippingOptions(events: NostrEvent[]): ShippingOption[] {
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
    .map(parseShippingOption)
    .filter((o): o is ShippingOption => o !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Format a shipping option for display, e.g. "Post — 5 000 sats". */
export function formatShippingOption(option: ShippingOption): string {
  const parts = [option.title];
  if (option.price) {
    parts.push(`${option.price.value} ${option.price.currency}`);
  }
  return parts.join(' — ');
}

/** Label a service type for display. */
export function formatShippingService(service: ShippingOptionService): string {
  switch (service) {
    case 'standard':
      return 'Standard post';
    case 'express':
      return 'Express post';
    case 'overnight':
      return 'Overnight';
    case 'pickup':
      return 'Collect in person';
    case 'digital':
      return 'Digital delivery';
    default:
      return service;
  }
}
