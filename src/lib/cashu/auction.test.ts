import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  auctionAddress,
  buildAuctionEvent,
  buildBidEvent,
  canBuyNow,
  dedupeAuctionListings,
  isAuctionClosed,
  parseAuctionBid,
  parseAuctionListing,
  summarizeBids,
  validateBidAmount,
  AUCTION_BID_KIND,
} from './auction';
import { NIP99_CLASSIFIED_KIND } from '@/lib/nip99';

const SELLER = 'a'.repeat(64);
const BIDDER1 = 'b'.repeat(64);
const BIDDER2 = 'c'.repeat(64);
const NOW = 1_800_000_000;

function makeEvent(overrides: Partial<NostrEvent> & { tags: string[][] }): NostrEvent {
  const base: NostrEvent = {
    id: '0'.repeat(64),
    pubkey: SELLER,
    created_at: NOW,
    kind: NIP99_CLASSIFIED_KIND,
    tags: [],
    content: '',
    sig: '0'.repeat(128),
  } as NostrEvent;
  return { ...base, ...overrides, tags: overrides.tags } as NostrEvent;
}

function makeAuction(overrides: Record<string, unknown> = {}): NostrEvent {
  return makeEvent({
    tags: [
      ['d', 'art-1'],
      ['title', 'Signed Bitcoin poster'],
      ['auction', 'auction'],
      ['price', '1000', 'sats'],
      ['close', String(NOW + 3600)],
      ['buy_now', '50000'],
      ['t', 'art'],
      ...(overrides.tags as string[][] ?? []),
    ],
    ...overrides,
  });
}

describe('parseAuctionListing', () => {
  it('parses a well-formed auction event', () => {
    const a = parseAuctionListing(makeAuction());
    expect(a).not.toBeNull();
    expect(a!.title).toBe('Signed Bitcoin poster');
    expect(a!.startingSats).toBe(1000);
    expect(a!.buyNowSats).toBe(50000);
    expect(a!.closesAt).toBe(NOW + 3600);
    expect(a!.id).toBe(`${SELLER}:art-1`);
  });

  it('returns null for a regular (non-auction) listing', () => {
    const regular = makeEvent({
      tags: [['d', 'x'], ['title', 'Plain'], ['price', '5', 'sats']],
    });
    expect(parseAuctionListing(regular)).toBeNull();
  });

  it('returns null when close or price tags are missing/invalid', () => {
    expect(parseAuctionListing(makeAuction({ tags: [['d', 'x'], ['auction', 'auction']] }))).toBeNull();
    expect(
      parseAuctionListing(makeAuction({ tags: [['d', 'x'], ['auction', 'auction'], ['close', 'abc']] })),
    ).toBeNull();
  });

  it('rejects non-https image URLs', () => {
    const a = parseAuctionListing(
      makeAuction({ tags: [['d', 'x'], ['auction', 'auction'], ['price', '1', 'sats'], ['close', '1'], ['image', 'javascript:alert(1)']] }),
    );
    expect(a!.images).toHaveLength(0);
  });
});

describe('dedupeAuctionListings', () => {
  it('keeps the latest event per address and sorts by close time', () => {
    const ev1 = makeAuction({ tags: [['d', 'a'], ['auction', 'auction'], ['price', '1', 'sats'], ['close', String(NOW + 100)]] , created_at: NOW });
    const ev2 = makeAuction({ tags: [['d', 'a'], ['auction', 'auction'], ['price', '2', 'sats'], ['close', String(NOW + 100)]], created_at: NOW + 50 });
    const ev3 = makeAuction({ tags: [['d', 'b'], ['auction', 'auction'], ['price', '3', 'sats'], ['close', String(NOW + 50)]], created_at: NOW });
    const result = dedupeAuctionListings([ev1, ev2, ev3]);
    expect(result).toHaveLength(2);
    expect(result[0]!.startingSats).toBe(3); // closes sooner
    expect(result[1]!.startingSats).toBe(2); // latest version of d=a
  });
});

describe('parseAuctionBid', () => {
  it('parses a valid bid', () => {
    const bid = parseAuctionBid({
      kind: AUCTION_BID_KIND,
      pubkey: BIDDER1,
      created_at: NOW,
      id: 'e'.repeat(64),
      tags: [
        ['d', 'bid-slot'],
        ['a', auctionAddress(SELLER, 'art-1')],
        ['amount', '1500', 'sats'],
        ['p2pk', BIDDER1],
      ],
      content: '',
      sig: '0'.repeat(128),
    } as NostrEvent);
    expect(bid).not.toBeNull();
    expect(bid!.amountSats).toBe(1500);
    expect(bid!.escrowPubkey).toBe(BIDDER1);
  });

  it('returns null when amount or address is missing', () => {
    expect(
      parseAuctionBid({ kind: AUCTION_BID_KIND, pubkey: BIDDER1, created_at: NOW, id: 'e'.repeat(64), tags: [['d', 'x']], content: '', sig: '0'.repeat(128) } as NostrEvent),
    ).toBeNull();
  });
});

describe('summarizeBids', () => {
  const addr = auctionAddress(SELLER, 'art-1');

  it('ranks bids highest-first and computes the next minimum', () => {
    const state = summarizeBids(
      [
        { eventId: '1', pubkey: BIDDER1, amountSats: 1200, auctionAddress: addr, createdAt: NOW },
        { eventId: '2', pubkey: BIDDER2, amountSats: 2500, auctionAddress: addr, createdAt: NOW + 10 },
      ],
      1000,
    );
    expect(state.highest!.amountSats).toBe(2500);
    expect(state.minNextBid).toBe(2501);
  });

  it('falls back to the starting price with no bids', () => {
    const state = summarizeBids([], 1000);
    expect(state.highest).toBeNull();
    expect(state.minNextBid).toBe(1000);
  });

  it('keeps a bidder\'s highest bid when they bid twice', () => {
    const state = summarizeBids(
      [
        { eventId: '1', pubkey: BIDDER1, amountSats: 1200, auctionAddress: addr, createdAt: NOW },
        { eventId: '2', pubkey: BIDDER1, amountSats: 1800, auctionAddress: addr, createdAt: NOW + 10 },
      ],
      1000,
    );
    expect(state.sorted).toHaveLength(1);
    expect(state.sorted[0]!.amountSats).toBe(1800);
  });
});

describe('isAuctionClosed / validateBidAmount', () => {
  const auction = parseAuctionListing(makeAuction())!;

  it('reports open before close', () => {
    expect(isAuctionClosed(auction, NOW + 3599)).toBe(false);
  });

  it('reports closed after close and on sold status', () => {
    expect(isAuctionClosed(auction, NOW + 3600)).toBe(true);
    expect(isAuctionClosed({ ...auction, status: 'sold' }, NOW)).toBe(true);
  });

  it('rejects bids below the floor', () => {
    expect(validateBidAmount(999, auction, null, NOW)).toMatch(/at least 1,000/);
  });

  it('rejects bids below highest + increment', () => {
    const highest = { eventId: 'x', pubkey: BIDDER2, amountSats: 1500, auctionAddress: '', createdAt: NOW };
    expect(validateBidAmount(1500, auction, highest, NOW)).toMatch(/at least 1,501/);
  });

  it('rejects bids above buy-now', () => {
    expect(validateBidAmount(60000, auction, null, NOW)).toMatch(/buy-now/);
  });

  it('accepts a valid bid', () => {
    expect(validateBidAmount(2000, auction, null, NOW)).toBeNull();
  });
});

describe('canBuyNow', () => {
  const auction = parseAuctionListing(makeAuction())!; // buy_now = 50000, closes NOW+3600

  it('is available when buy-now price set and auction active with no bids', () => {
    expect(canBuyNow(auction, null, NOW)).toBe(true);
  });

  it('is unavailable when no buy-now price set', () => {
    const noBuyNow = parseAuctionListing(makeAuction({ tags: [
      ['d', 'art-1'],
      ['auction', 'auction'],
      ['price', '1000', 'sats'],
      ['close', String(NOW + 3600)],
    ] }))!;
    expect(canBuyNow(noBuyNow, null, NOW)).toBe(false);
  });

  it('is unavailable after close', () => {
    expect(canBuyNow(auction, null, NOW + 3600)).toBe(false);
  });

  it('is unavailable once highest bid reaches buy-now price', () => {
    const atBuyNow = { eventId: 'x', pubkey: BIDDER2, amountSats: 50000, auctionAddress: '', createdAt: NOW };
    expect(canBuyNow(auction, atBuyNow, NOW)).toBe(false);
  });

  it('is available while highest bid is below buy-now price', () => {
    const below = { eventId: 'x', pubkey: BIDDER2, amountSats: 49999, auctionAddress: '', createdAt: NOW };
    expect(canBuyNow(auction, below, NOW)).toBe(true);
  });

  it('is unavailable for sold auctions', () => {
    expect(canBuyNow({ ...auction, status: 'sold' }, null, NOW)).toBe(false);
  });

  it('allows a bid exactly at the buy-now price (Buy It Now flow)', () => {
    expect(validateBidAmount(50000, auction, null, NOW)).toBeNull();
    // After that bid lands, Buy It Now must disappear (bidding reached it).
    const atBuyNow = { eventId: 'x', pubkey: BIDDER2, amountSats: 50000, auctionAddress: '', createdAt: NOW };
    expect(canBuyNow(auction, atBuyNow, NOW)).toBe(false);
    // ...but the bid itself stays valid against the closed floor.
    expect(validateBidAmount(50000, auction, atBuyNow, NOW)).toMatch(/at least 50,001/);
  });
});

describe('buildAuctionEvent / buildBidEvent', () => {
  it('emits a clamped close time and required tags', () => {
    const ev = buildAuctionEvent({
      sellerPubkey: SELLER,
      dTag: 'art-1',
      title: 'Poster',
      startingSats: 1000,
      durationHours: 72,
      now: NOW,
    });
    expect(ev.kind).toBe(NIP99_CLASSIFIED_KIND);
    const close = ev.tags.find((t) => t[0] === 'close')![1];
    expect(Number(close)).toBe(NOW + 72 * 3600);
    expect(ev.tags).toContainEqual(['auction', 'auction']);
    expect(ev.tags).toContainEqual(['d', 'art-1']);
  });

  it('clamps oversized durations to the 30-day cap', () => {
    const ev = buildAuctionEvent({
      sellerPubkey: SELLER,
      dTag: 'x',
      title: 'T',
      startingSats: 1,
      durationHours: 99999,
      now: NOW,
    });
    const close = Number(ev.tags.find((t) => t[0] === 'close')![1]);
    expect(close).toBe(NOW + 720 * 3600);
  });

  it('emits bid events tagged to the auction address', () => {
    const addr = auctionAddress(SELLER, 'art-1');
    const ev = buildBidEvent({
      bidderPubkey: BIDDER1,
      auctionAddress: addr,
      amountSats: 1500,
      escrowPubkey: BIDDER1,
      now: NOW,
    });
    expect(ev.kind).toBe(AUCTION_BID_KIND);
    expect(ev.tags).toContainEqual(['a', addr]);
    expect(ev.tags).toContainEqual(['amount', '1500', 'sats']);
  });
});
