import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import {
  buildAuctionSettleTags,
  clearPendingBidDeposit,
  loadPendingBidDeposits,
  refundUnlocked,
  resolveWinningBid,
  savePendingBidDeposit,
} from './auctionSettlement';
import { auctionAddress, type AuctionListing } from './auction';
import { NIP99_CLASSIFIED_KIND } from '@/lib/nip99';

const SELLER = 'a'.repeat(64);
const NOW = 1_800_000_000;

function makeAuctionEvent(): NostrEvent {
  return {
    id: '1'.repeat(64),
    pubkey: SELLER,
    created_at: NOW,
    kind: NIP99_CLASSIFIED_KIND,
    tags: [
      ['d', 'art-1'],
      ['auction', 'auction'],
      ['price', '1000', 'sats'],
      ['close', String(NOW + 3600)],
    ],
    content: '',
    sig: '2'.repeat(128),
  } as NostrEvent;
}

const auction: AuctionListing = {
  id: `${SELLER}:art-1`,
  eventId: '1'.repeat(64),
  pubkey: SELLER,
  dTag: 'art-1',
  title: 'Poster',
  summary: '',
  content: '',
  images: [],
  categories: [],
  status: 'active',
  createdAt: NOW,
  startingSats: 1000,
  closesAt: NOW + 3600,
  event: makeAuctionEvent(),
};

describe('resolveWinningBid', () => {
  it('picks the highest bid', () => {
    const winner = resolveWinningBid(
      [
        { eventId: '1', pubkey: 'b'.repeat(64), amountSats: 1200, auctionAddress: '', createdAt: NOW },
        { eventId: '2', pubkey: 'c'.repeat(64), amountSats: 3000, auctionAddress: '', createdAt: NOW + 5 },
      ],
      auction,
    );
    expect(winner!.amountSats).toBe(3000);
  });

  it('breaks amount ties by earliest bid (eBay first-mover rule)', () => {
    const winner = resolveWinningBid(
      [
        { eventId: '1', pubkey: 'b'.repeat(64), amountSats: 2000, auctionAddress: '', createdAt: NOW },
        { eventId: '2', pubkey: 'c'.repeat(64), amountSats: 2000, auctionAddress: '', createdAt: NOW + 10 },
      ],
      auction,
    );
    // A later equal bid never displaces the earlier leader.
    expect(winner!.eventId).toBe('1');
  });

  it('returns null with no valid bids', () => {
    expect(resolveWinningBid([], auction)).toBeNull();
    expect(
      resolveWinningBid([{ eventId: 'x', pubkey: 'b'.repeat(64), amountSats: 0, auctionAddress: '', createdAt: NOW }], auction),
    ).toBeNull();
  });
});

describe('buildAuctionSettleTags', () => {
  it('adds status sold when absent', () => {
    const tags = buildAuctionSettleTags(auction);
    expect(tags).toContainEqual(['status', 'sold']);
    // original tags preserved
    expect(tags).toContainEqual(['d', 'art-1']);
  });

  it('replaces an existing status tag', () => {
    const withStatus: AuctionListing = {
      ...auction,
      event: {
        ...auction.event,
        tags: [...auction.event.tags, ['status', 'active']],
      },
    };
    const tags = buildAuctionSettleTags(withStatus);
    const statuses = tags.filter((t) => t[0] === 'status');
    expect(statuses).toEqual([['status', 'sold']]);
  });
});

describe('bid deposit journal', () => {
  it('saves, loads, and clears deposit journals', () => {
    const addr = auctionAddress(SELLER, 'art-1');
    savePendingBidDeposit({
      auctionAddress: addr,
      token: 'cashu-test-token',
      amountSats: 1500,
      locktime: NOW + 86400,
    });
    const loaded = loadPendingBidDeposits();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.token).toBe('cashu-test-token');
    expect(loaded[0]!.amountSats).toBe(1500);

    clearPendingBidDeposit(addr);
    expect(loadPendingBidDeposits()).toHaveLength(0);
  });

  it('skips corrupt entries instead of throwing', () => {
    localStorage.setItem('bao_auction_bid_junk', '{not json');
    expect(loadPendingBidDeposits()).toHaveLength(0);
    localStorage.removeItem('bao_auction_bid_junk');
  });
});

describe('refundUnlocked', () => {
  it('unlocks at and after the locktime', () => {
    expect(refundUnlocked({ locktime: NOW }, NOW - 1)).toBe(false);
    expect(refundUnlocked({ locktime: NOW }, NOW)).toBe(true);
    expect(refundUnlocked({ locktime: NOW }, NOW + 1)).toBe(true);
  });
});
