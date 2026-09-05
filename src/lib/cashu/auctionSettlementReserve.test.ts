import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { parseAuctionListing, type AuctionBid } from '@/lib/cashu/auction';
import { createCommitment } from '@/lib/cashu/auctionCommit';
import {
  buildReserveRevealTags,
  parseReserveReveal,
  resolveSettlementWithReserve,
  resolveWinningBid,
} from '@/lib/cashu/auctionSettlement';

const SELLER = 'a'.repeat(64);
const B1 = 'b'.repeat(64);
const B2 = 'c'.repeat(64);

function makeAuctionEvent(tags: string[][]): NostrEvent {
  return {
    kind: 30402,
    pubkey: SELLER,
    created_at: 1_000,
    id: '1'.repeat(64),
    tags,
    content: '',
    sig: '0'.repeat(128),
  } as unknown as NostrEvent;
}

let seq = 0;
function bid(pubkey: string, amountSats: number, createdAt: number): AuctionBid {
  seq += 1;
  return { eventId: `ev-${seq}`, pubkey, amountSats, auctionAddress: '', createdAt };
}

function makeAuction(extraTags: string[][] = []) {
  const base = [
    ['d', 'reserve-test'],
    ['title', 'Reserve auction'],
    ['auction', 'auction'],
    ['price', '1000', 'sats'],
    ['close', '9999999999'],
  ];
  return parseAuctionListing(makeAuctionEvent([...base, ...extraTags]))!;
}

describe('resolveWinningBid tie rule', () => {
  it('earliest bid wins an amount tie (first-mover keeps the lead)', () => {
    const early = bid(B1, 5_000, 100);
    const late = bid(B2, 5_000, 200);
    const winner = resolveWinningBid([late, early], makeAuction());
    expect(winner?.eventId).toBe(early.eventId);
  });
});

describe('resolveSettlementWithReserve', () => {
  it('no reserve commitment → winner stands', () => {
    const auction = makeAuction();
    const w = bid(B1, 4_000, 100);
    const r = resolveSettlementWithReserve({ auction, bids: [w], reserveReveal: null });
    expect(r.outcome).toEqual({ met: true });
    expect(r.winningBid?.eventId).toBe(w.eventId);
  });

  it('reserve committed but never revealed → NOT met, no winner (fail-closed)', () => {
    const { commitment } = createCommitment({ auctionAddress: '', pubkey: SELLER, valueSats: 10_000 });
    const auction = makeAuction([['reserve_commit', commitment]]);
    const w = bid(B1, 4_000, 100);
    const r = resolveSettlementWithReserve({ auction, bids: [w], reserveReveal: null });
    expect(r.outcome).toEqual({ met: false, reason: 'no-revealed-reserve' });
    expect(r.winningBid).toBeNull();
  });

  it('verified reveal below final price → met', () => {
    const addr = '30402:' + SELLER + ':reserve-test';
    const { commitment, secret } = createCommitment({ auctionAddress: addr, pubkey: SELLER, valueSats: 3_000 });
    const auction = makeAuction([['reserve_commit', commitment]]);
    const w = bid(B1, 4_000, 100);
    const r = resolveSettlementWithReserve({ auction, bids: [w], reserveReveal: secret });
    expect(r.outcome).toEqual({ met: true });
    expect(r.winningBid?.eventId).toBe(w.eventId);
  });

  it('verified reveal above final price → NOT met (refunds)', () => {
    const addr = '30402:' + SELLER + ':reserve-test';
    const { commitment, secret } = createCommitment({ auctionAddress: addr, pubkey: SELLER, valueSats: 9_000 });
    const auction = makeAuction([['reserve_commit', commitment]]);
    const w = bid(B1, 4_000, 100);
    const r = resolveSettlementWithReserve({ auction, bids: [w], reserveReveal: secret });
    expect(r.outcome).toEqual({ met: false, reason: 'below-revealed-reserve' });
    expect(r.winningBid).toBeNull();
  });

  it('a forged reveal (right shape, wrong value) is rejected → NOT met', () => {
    const addr = '30402:' + SELLER + ':reserve-test';
    const { commitment } = createCommitment({ auctionAddress: addr, pubkey: SELLER, valueSats: 1_000 });
    const auction = makeAuction([['reserve_commit', commitment]]);
    const w = bid(B1, 4_000, 100);
    const r = resolveSettlementWithReserve({
      auction,
      bids: [w],
      reserveReveal: { valueSats: 1_000, nonce: 'ab'.repeat(16) }, // nonce doesn't match
    });
    expect(r.outcome).toEqual({ met: false, reason: 'no-revealed-reserve' });
    expect(r.winningBid).toBeNull();
  });

  it('no bids + revealed reserve → NOT met (nothing to sell)', () => {
    const addr = '30402:' + SELLER + ':reserve-test';
    const { commitment, secret } = createCommitment({ auctionAddress: addr, pubkey: SELLER, valueSats: 1_000 });
    const auction = makeAuction([['reserve_commit', commitment]]);
    const r = resolveSettlementWithReserve({ auction, bids: [], reserveReveal: secret });
    expect(r.outcome).toEqual({ met: false, reason: 'below-revealed-reserve' });
    expect(r.winningBid).toBeNull();
  });
});

describe('reserve reveal tag round-trip', () => {
  it('build → parse → verify binds to the commitment', () => {
    const addr = '30402:' + SELLER + ':reserve-test';
    const { commitment, secret } = createCommitment({ auctionAddress: addr, pubkey: SELLER, valueSats: 7_500 });
    const auction = makeAuction([['reserve_commit', commitment]]);
    const tags = buildReserveRevealTags(auction, secret);
    const republished = parseAuctionListing(makeAuctionEvent(tags))!;
    const parsed = parseReserveReveal(republished);
    expect(parsed).toEqual(secret);
    // And the settlement accepts it:
    const w = bid(B1, 8_000, 100);
    const r = resolveSettlementWithReserve({ auction: republished, bids: [w], reserveReveal: parsed });
    expect(r.outcome).toEqual({ met: true });
  });

  it('parses garbage reveal tags to null (never throws)', () => {
    const auction = makeAuction([['reserve_reveal', 'not json']]);
    expect(parseReserveReveal(auction)).toBeNull();
    const bad = makeAuction([['reserve_reveal', JSON.stringify({ v: 'x', n: 'zz' })]]);
    expect(parseReserveReveal(bad)).toBeNull();
  });
});
