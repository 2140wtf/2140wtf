/**
 * Cashu auctions for the 2140.wtf /market page.
 *
 * An auction is a NIP-99 classified listing (kind 30402) that carries an
 * `auction` tag plus auction-specific parameters. Bids are published as
 * parameterized-replaceable kind 30401 events tagged to the auction's
 * NIP-33 address (`a` tag = `30402:<seller-pubkey>:<d>`), so bidders can
 * update their own bid by republishing with the same `d` and everyone can
 * query the full bid history for an auction with a single filter.
 *
 * Money flow (no Lightning, no on-chain): each bid locks real Cashu tokens
 * with the app's existing 2-of-3 multisig escrow primitive
 * ({@link !../cashu/escrowMultisig} — the same primitive pet battles use).
 * The lock parties are {highest bidder at close, seller, escrow operator}:
 *   - Auction won:  operator + seller co-sign → tokens release to the seller.
 *   - Outbid/lost:  operator + bidder co-sign (or refund after locktime) →
 *                   tokens return to the bidder.
 * The operator can never take funds alone, and a losing bidder can always
 * reclaim via the refund path after the locktime.
 *
 * Bid tokens are NOT embedded in the bid event (that would leak spendable
 * proofs to every relay reader). The bid event carries only the bid amount
 * and the bidder's P2PK escrow pubkey; the token itself travels out-of-band
 * (NIP-17 DM to the seller) and is validated at settlement time.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import { NIP99_CLASSIFIED_KIND } from '@/lib/nip99';

/** Kind for individual auction bids (parameterized-replaceable). */
export const AUCTION_BID_KIND = 30401;

/** Tag value marking a kind-30402 listing as an auction. */
export const AUCTION_TYPE_TAG = 'auction';

/** Default auction duration in hours (3 days). */
export const DEFAULT_AUCTION_DURATION_HOURS = 72;

/** Minimum sensible bid increment in sats. */
export const MIN_BID_INCREMENT_SATS = 1;

/** Hard cap on auction duration (30 days) to prevent spam listings. */
export const MAX_AUCTION_DURATION_HOURS = 24 * 30;

export interface AuctionListing {
  id: string;
  eventId: string;
  pubkey: string;
  dTag: string;
  title: string;
  summary: string;
  content: string;
  images: string[];
  categories: string[];
  status: 'active' | 'sold' | 'draft';
  createdAt: number;
  /** Starting price / reserve in sats. */
  startingSats: number;
  /** Optional buy-now price in sats; 0/undefined = no buy-now. */
  buyNowSats?: number;
  /** Unix seconds when bidding closes. */
  closesAt: number;
  /** The original Nostr event. */
  event: NostrEvent;
}

/** A single bid on an auction. */
export interface AuctionBid {
  eventId: string;
  pubkey: string;
  /** Bid amount in sats. */
  amountSats: number;
  /** Bidder's P2PK pubkey for the escrow lock (x-only or compressed hex). */
  escrowPubkey?: string;
  /** The auction's NIP-33 address this bid targets. */
  auctionAddress: string;
  createdAt: number;
}

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
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

/**
 * Parse a kind-30402 event into an {@link AuctionListing}. Returns null for
 * regular listings (no `auction` tag) or malformed events — relay spam must
 * never render as an auction.
 */
export function parseAuctionListing(event: NostrEvent): AuctionListing | null {
  if (event.kind !== NIP99_CLASSIFIED_KIND) return null;
  if (getTag(event, 'auction') !== AUCTION_TYPE_TAG) return null;

  const dTag = getTag(event, 'd');
  if (!dTag) return null;

  const startingSats = Number(getTag(event, 'price'));
  if (!Number.isSafeInteger(startingSats) || startingSats < 0) return null;

  const closesAt = Number(getTag(event, 'close'));
  if (!Number.isSafeInteger(closesAt) || closesAt <= 0) return null;

  const buyNowRaw = getTag(event, 'buy_now');
  const buyNowSats = buyNowRaw ? Number(buyNowRaw) : NaN;

  return {
    id: `${event.pubkey}:${dTag}`,
    eventId: event.id,
    pubkey: event.pubkey,
    dTag,
    title: getTag(event, 'title')?.trim() || dTag,
    summary: getTag(event, 'summary')?.trim() || '',
    content: event.content || '',
    images: event.tags
      .filter((t) => t[0] === 'image' && typeof t[1] === 'string')
      .map((t) => t[1])
      .filter(isAllowedImageUrl),
    categories: event.tags
      .filter((t) => t[0] === 't' && typeof t[1] === 'string')
      .map((t) => t[1].toLowerCase()),
    status: getTag(event, 'status')?.toLowerCase() === 'sold' ? 'sold' : 'active',
    createdAt: event.created_at,
    startingSats,
    buyNowSats:
      Number.isSafeInteger(buyNowSats) && buyNowSats > 0 ? buyNowSats : undefined,
    closesAt,
    event,
  };
}

/**
 * Deduplicate auction events by NIP-33 address, keeping the latest version of
 * each, and return them sorted by close time (soonest first).
 */
export function dedupeAuctionListings(events: NostrEvent[]): AuctionListing[] {
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
    .map(parseAuctionListing)
    .filter((a): a is AuctionListing => a !== null)
    .sort((a, b) => a.closesAt - b.closesAt);
}

/**
 * Parse a kind-30401 bid event. Returns null for malformed events.
 */
export function parseAuctionBid(event: NostrEvent): AuctionBid | null {
  if (event.kind !== AUCTION_BID_KIND) return null;

  const auctionAddress = getTag(event, 'a');
  if (!auctionAddress) return null;

  const amountSats = Number(getTag(event, 'amount'));
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) return null;

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    amountSats,
    escrowPubkey: getTag(event, 'p2pk'),
    auctionAddress,
    createdAt: event.created_at,
  };
}

/**
 * Build the unsigned event template for a new auction (kind 30402).
 * Pass the result to `useNostrPublish().mutateAsync`.
 */
export function buildAuctionEvent(input: {
  sellerPubkey: string;
  dTag: string;
  title: string;
  summary?: string;
  content?: string;
  images?: string[];
  categories?: string[];
  startingSats: number;
  buyNowSats?: number;
  /** Auction duration in hours (clamped to [1, 720]). */
  durationHours: number;
  /** Unix seconds when the auction is created. */
  now: number;
}): {
  kind: typeof NIP99_CLASSIFIED_KIND;
  content: string;
  tags: string[][];
  created_at: number;
} {
  const duration = Math.max(
    1,
    Math.min(MAX_AUCTION_DURATION_HOURS, Math.round(input.durationHours)),
  );
  const closesAt = input.now + duration * 3600;

  const tags: string[][] = [
    ['d', input.dTag],
    ['title', input.title],
    ['auction', AUCTION_TYPE_TAG],
    ['price', String(Math.max(0, Math.round(input.startingSats))), 'sats'],
    ['close', String(closesAt)],
    ['t', 'auction'],
  ];

  if (input.buyNowSats && input.buyNowSats > 0) {
    tags.push(['buy_now', String(Math.round(input.buyNowSats))]);
  }
  if (input.summary?.trim()) tags.push(['summary', input.summary.trim()]);
  for (const img of input.images ?? []) {
    tags.push(['image', img]);
  }
  for (const cat of new Set(input.categories ?? [])) {
    if (cat.trim()) tags.push(['t', cat.trim().toLowerCase()]);
  }
  tags.push(['published_at', String(input.now)]);
  tags.push(['alt', `Auction: ${input.title}`]);

  return {
    kind: NIP99_CLASSIFIED_KIND,
    content: input.content?.trim() ?? '',
    tags,
    created_at: input.now,
  };
}

/**
 * Build the unsigned event template for a bid on an auction (kind 30401).
 *
 * The `d` tag is the bidder's own scoped bid slot — republishing with the
 * same `d` replaces (raises) their bid; a distinct `d` per bidder keeps
 * every bidder's current bid independently addressable.
 */
export function buildBidEvent(input: {
  bidderPubkey: string;
  auctionAddress: string;
  amountSats: number;
  /** Bidder's P2PK escrow pubkey (the token lock target). */
  escrowPubkey: string;
  /** Optional bid id; defaults to `bid-<auctionAddress hash>` style slot. */
  bidId?: string;
  now: number;
}): {
  kind: typeof AUCTION_BID_KIND;
  content: string;
  tags: string[][];
  created_at: number;
} {
  const d = input.bidId ?? `bid-${input.auctionAddress.split(':').slice(0, 2).join('-')}`;
  return {
    kind: AUCTION_BID_KIND,
    content: '',
    tags: [
      ['d', d],
      ['a', input.auctionAddress],
      ['amount', String(Math.max(1, Math.round(input.amountSats))), 'sats'],
      ['p2pk', input.escrowPubkey],
      ['alt', `Bid ${input.amountSats} sats on ${input.auctionAddress}`],
    ],
    created_at: input.now,
  };
}

/**
 * The NIP-33 address of an auction: `30402:<seller-pubkey>:<d>`.
 */
export function auctionAddress(sellerPubkey: string, dTag: string): string {
  return `${NIP99_CLASSIFIED_KIND}:${sellerPubkey}:${dTag}`;
}

export interface AuctionBidState {
  /** Highest bid, or null when no bids yet. */
  highest: AuctionBid | null;
  /** All bids sorted by amount (descending), then by recency. */
  sorted: AuctionBid[];
  /** Bids from the given pubkey only. */
  byBidder: (pubkey: string) => AuctionBid[];
  /** Next minimum acceptable bid (starting price or highest + increment). */
  minNextBid: number;
}

/**
 * Reduce a list of parsed bids for one auction into display state.
 * Duplicate per-bidder slots resolve to the bidder's latest event.
 */
export function summarizeBids(
  bids: AuctionBid[],
  startingSats: number,
): AuctionBidState {
  // Keep only the latest bid per (pubkey, d-tag) pair — kind 30401 is
  // parameterized-replaceable, so relays may serve stale versions.
  const latest = new Map<string, AuctionBid>();
  for (const bid of bids) {
    const key = bid.auctionAddress;
    const existing = latest.get(key);
    // Same bidder targeting the same auction: keep the higher amount, or the
    // more recent event when amounts tie.
    if (
      !existing ||
      bid.amountSats > existing.amountSats ||
      (bid.amountSats === existing.amountSats && bid.createdAt > existing.createdAt)
    ) {
      latest.set(key, bid);
    }
  }

  const sorted = Array.from(latest.values()).sort(
    (a, b) =>
      b.amountSats - a.amountSats ||
      b.createdAt - a.createdAt,
  );

  const highest = sorted[0] ?? null;
  const minNextBid = highest
    ? highest.amountSats + MIN_BID_INCREMENT_SATS
    : Math.max(1, startingSats);

  return {
    highest,
    sorted,
    byBidder: (pubkey: string) => sorted.filter((b) => b.pubkey === pubkey),
    minNextBid,
  };
}

/**
 * Whether an auction has closed. A `sold` status also ends bidding.
 */
export function isAuctionClosed(
  auction: Pick<AuctionListing, 'closesAt' | 'status'>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return auction.status === 'sold' || nowSeconds >= auction.closesAt;
}

/**
 * Validate a bid amount against the auction state. Returns an error message
 * or null when the bid is acceptable.
 */
export function validateBidAmount(
  amountSats: number,
  auction: AuctionListing,
  currentHighest: AuctionBid | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string | null {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    return 'Bid must be a positive whole number of sats.';
  }
  if (isAuctionClosed(auction, nowSeconds)) {
    return 'This auction has closed.';
  }
  const floor = currentHighest
    ? currentHighest.amountSats + MIN_BID_INCREMENT_SATS
    : Math.max(1, auction.startingSats);
  if (amountSats < floor) {
    return `Bid must be at least ${floor.toLocaleString()} sats.`;
  }
  if (auction.buyNowSats && amountSats > auction.buyNowSats) {
    return `Bid exceeds the buy-now price (${auction.buyNowSats.toLocaleString()} sats) — use Buy now instead.`;
  }
  return null;
}
